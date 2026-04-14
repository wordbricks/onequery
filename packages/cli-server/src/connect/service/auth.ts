import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Result } from "better-result";

import {
  createAuthProxyRequest,
  createBearerHeaders,
  parseRetryAfterMs,
  readBetterAuthDeviceCodeResponse,
  readBetterAuthDeviceTokenErrorResponse,
  readBetterAuthDeviceTokenSuccessResponse,
  toCliDeviceAuthProblemDetail,
} from "../../auth/device-transport";
import {
  refreshCliSessionIdentity,
  resolveCliSessionIdentity,
} from "../../auth/session-identity";
import {
  CLI_DEFAULT_LOGIN_TIMEOUT_SEC,
  CLI_DEFAULT_POLL_AFTER_MS,
  CLI_DEVICE_AUTH_CLIENT_ID,
  CLI_DEVICE_AUTH_CODE_PATH,
  CLI_DEVICE_AUTH_GRANT_TYPE,
  CLI_DEVICE_AUTH_TOKEN_PATH,
  deviceAuthorizationPollAfterMs,
  slowedDeviceAuthorizationPollAfterMs,
} from "../../cli-defaults";
import type { CliSessionIdentity } from "../../domain/workflows";
import { toCliAuthUserView } from "../../domain/workflows";
import { requireCliConnectRequestContext } from "../context";
import {
  CliAuthMode,
  CliAuthorizedDeviceAuthorizationSchema,
  GetSessionResponseSchema,
  PollDeviceAuthorizationResponseSchema,
  RefreshSessionResponseSchema,
} from "../gen/onequery/cli/v1/auth_pb";
import { resolveCliSessionIdentityResult } from "./access";
import type { CliResultServiceMethod } from "./result";
import { cliServiceErr, liftCliServiceMethod } from "./result";

type GetSessionResponseInit = MessageInitShape<typeof GetSessionResponseSchema>;
type RefreshSessionResponseInit = MessageInitShape<
  typeof RefreshSessionResponseSchema
>;
type CliAuthorizedDeviceAuthorizationInit = MessageInitShape<
  typeof CliAuthorizedDeviceAuthorizationSchema
>;

type CliAuthUserInit = {
  id?: string;
  email?: string;
  displayName?: string;
};

function timestampFromIsoString(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }

  return timestampFromDate(parsed);
}

function toCliAuthMode(value: CliSessionIdentity["authMode"]) {
  switch (value) {
    case "browser_session":
      return CliAuthMode.BROWSER_SESSION;
    case "bearer_token":
      return CliAuthMode.BEARER_TOKEN;
  }
}

const handleGetSessionImpl: CliResultServiceMethod<"getSession"> = async (
  _request,
  context
) =>
  Result.gen(async function* handleGetSessionFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const session = yield* Result.await(requestContext.resolveSession());

    return Result.ok(buildCliAuthSession(session));
  });

const handleRefreshSessionImpl: CliResultServiceMethod<
  "refreshSession"
> = async (_request, context) =>
  Result.gen(async function* handleRefreshSessionFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;

    yield* Result.await(requestContext.resolveSession());
    const session = yield* resolveCliSessionIdentityResult(
      await refreshCliSessionIdentity(c.var.storage, c.req.raw.headers)
    );

    return Result.ok(buildCliRefreshSession(session));
  });

const handleStartDeviceAuthorizationImpl: CliResultServiceMethod<
  "startDeviceAuthorization"
> = async (_request, context) => {
  const c = requireCliConnectRequestContext(context).honoContext;
  const response = await c.var.storage.auth.handler(
    createAuthProxyRequest(c.req.raw, CLI_DEVICE_AUTH_CODE_PATH, {
      client_id: CLI_DEVICE_AUTH_CLIENT_ID,
    })
  );

  if (response.status === 200) {
    const payload = await readBetterAuthDeviceCodeResponse(response);
    const expiresInSec = payload.expires_in ?? CLI_DEFAULT_LOGIN_TIMEOUT_SEC;

    return Result.ok({
      state: "pending",
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      ...buildDeviceVerificationUrls(
        c.var.runtime.auth.baseURL,
        payload.user_code
      ),
      pollAfterMs: deviceAuthorizationPollAfterMs(payload.interval),
      expiresAt: timestampFromDate(new Date(Date.now() + expiresInSec * 1000)),
    });
  }

  if (response.status === 400) {
    const payload = await readBetterAuthDeviceTokenErrorResponse(response);
    return cliServiceErr({
      detail: toCliDeviceAuthProblemDetail(payload),
      key: "AUTH_REQUEST_INVALID",
    });
  }

  if (response.status === 429) {
    return cliServiceErr({
      detail: "device authorization start was rate-limited",
      key: "LOGIN_RATE_LIMITED",
      retryAfterMs: parseRetryAfterMs(response),
    });
  }

  throw new Error(
    `unexpected Better Auth response for ${CLI_DEVICE_AUTH_CODE_PATH}: ${response.status}`
  );
};

const handlePollDeviceAuthorizationImpl: CliResultServiceMethod<
  "pollDeviceAuthorization"
> = async (request, context) =>
  Result.gen(async function* handlePollDeviceAuthorizationFlow() {
    const c = requireCliConnectRequestContext(context).honoContext;
    const response = await c.var.storage.auth.handler(
      createAuthProxyRequest(c.req.raw, CLI_DEVICE_AUTH_TOKEN_PATH, {
        client_id: CLI_DEVICE_AUTH_CLIENT_ID,
        device_code: request.deviceCode,
        grant_type: CLI_DEVICE_AUTH_GRANT_TYPE,
      })
    );

    if (response.status === 200) {
      const payload = await readBetterAuthDeviceTokenSuccessResponse(response);
      const session = yield* resolveCliSessionIdentityResult(
        await resolveCliSessionIdentity(
          c.var.storage,
          createBearerHeaders(c.req.raw, payload.access_token)
        )
      );

      return Result.ok({
        outcome: {
          case: "authorized",
          value: buildAuthorizedDeviceAuthorizationResponse({
            accessToken: payload.access_token,
            session,
          }),
        },
      } satisfies MessageInitShape<
        typeof PollDeviceAuthorizationResponseSchema
      >);
    }

    if (response.status === 400) {
      const payload = await readBetterAuthDeviceTokenErrorResponse(response);

      if (payload.error === "authorization_pending") {
        return Result.ok({
          outcome: {
            case: "pending",
            value: {
              state: "pending",
              pollAfterMs: CLI_DEFAULT_POLL_AFTER_MS,
            },
          },
        } satisfies MessageInitShape<
          typeof PollDeviceAuthorizationResponseSchema
        >);
      }

      if (payload.error === "slow_down") {
        return Result.ok({
          outcome: {
            case: "pending",
            value: {
              state: "pending",
              pollAfterMs: slowedDeviceAuthorizationPollAfterMs(),
            },
          },
        } satisfies MessageInitShape<
          typeof PollDeviceAuthorizationResponseSchema
        >);
      }

      if (payload.error === "access_denied") {
        return cliServiceErr({
          detail:
            payload.error_description === undefined
              ? "device authorization was denied"
              : toCliDeviceAuthProblemDetail(payload),
          key: "LOGIN_DENIED",
        });
      }

      if (payload.error === "expired_token") {
        return cliServiceErr({
          detail:
            payload.error_description === undefined
              ? "device authorization session expired"
              : toCliDeviceAuthProblemDetail(payload),
          key: "LOGIN_SESSION_EXPIRED",
        });
      }

      return cliServiceErr({
        detail: toCliDeviceAuthProblemDetail(payload),
        key: "AUTH_REQUEST_INVALID",
      });
    }

    if (response.status === 429) {
      return cliServiceErr({
        detail: "device authorization polling was rate-limited",
        key: "LOGIN_RATE_LIMITED",
        retryAfterMs: parseRetryAfterMs(response),
      });
    }

    throw new Error(
      `unexpected Better Auth response for ${CLI_DEVICE_AUTH_TOKEN_PATH}: ${response.status}`
    );
  });

export const handleGetSession = liftCliServiceMethod(handleGetSessionImpl);

export const handleRefreshSession = liftCliServiceMethod(
  handleRefreshSessionImpl
);

export const handleStartDeviceAuthorization = liftCliServiceMethod(
  handleStartDeviceAuthorizationImpl
);

export const handlePollDeviceAuthorization = liftCliServiceMethod(
  handlePollDeviceAuthorizationImpl
);

function buildCliAuthUser(user: CliSessionIdentity["user"]): CliAuthUserInit {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

function buildCliAuthSession(
  session: CliSessionIdentity
): GetSessionResponseInit {
  return {
    authMode: toCliAuthMode(session.authMode),
    user: buildCliAuthUser(toCliAuthUserView(session.user)),
    ...(session.activeOrg ? { activeOrgSlug: session.activeOrg } : {}),
    ...(session.issuedAt
      ? { issuedAt: timestampFromIsoString(session.issuedAt) }
      : {}),
    ...(session.expiresAt
      ? { expiresAt: timestampFromIsoString(session.expiresAt) }
      : {}),
  };
}

function buildCliRefreshSession(
  session: CliSessionIdentity
): RefreshSessionResponseInit {
  return {
    accessToken: session.accessToken,
    authMode: toCliAuthMode(session.authMode),
    user: buildCliAuthUser(session.user),
    ...(session.activeOrg ? { activeOrgSlug: session.activeOrg } : {}),
    ...(session.issuedAt
      ? { issuedAt: timestampFromIsoString(session.issuedAt) }
      : {}),
    ...(session.expiresAt
      ? { expiresAt: timestampFromIsoString(session.expiresAt) }
      : {}),
  };
}

function buildAuthorizedDeviceAuthorizationResponse(input: {
  accessToken: string;
  session: CliSessionIdentity;
}): CliAuthorizedDeviceAuthorizationInit {
  return {
    state: "authorized",
    accessToken: input.accessToken,
    authMode: toCliAuthMode(input.session.authMode),
    user: buildCliAuthUser(input.session.user),
    ...(input.session.activeOrg
      ? { activeOrgSlug: input.session.activeOrg }
      : {}),
    ...(input.session.issuedAt
      ? { issuedAt: timestampFromIsoString(input.session.issuedAt) }
      : {}),
    ...(input.session.expiresAt
      ? { expiresAt: timestampFromIsoString(input.session.expiresAt) }
      : {}),
  };
}

function buildDeviceVerificationUrls(baseUrl: string, userCode: string) {
  const resolvedBaseUrl = new URL(baseUrl);
  const verificationCompleteUrl = new URL("/device", resolvedBaseUrl);
  verificationCompleteUrl.searchParams.set("user_code", userCode);

  return {
    verificationCompleteUrl: verificationCompleteUrl.toString(),
    verificationUrl: new URL("/device", resolvedBaseUrl).toString(),
  };
}
