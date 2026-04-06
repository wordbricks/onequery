import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

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
import type { CliSelectedFields } from "../../read-controls-policy";
import { requireCliConnectHonoContext } from "../context";
import { throwCliConnectError } from "../error";
import {
  CliAuthorizedDeviceAuthorizationSchema,
  GetSessionResponseSchema,
  PollDeviceAuthorizationResponseSchema,
  RefreshSessionResponseSchema,
} from "../gen/onequery/cli/v1/auth_pb";
import { requireCliSessionIdentity } from "./access";
import { toCliAuthMode, timestampFromIsoString } from "./conversions";
import { parseCliFieldsReadControls } from "./read-controls";
import type { CliServiceMethod } from "./types";

const SESSION_FIELDS = [
  "authMode",
  "user",
  "user.id",
  "user.email",
  "user.displayName",
  "activeOrgSlug",
  "issuedAt",
  "expiresAt",
] as const;

type GetSessionResponseInit = MessageInitShape<typeof GetSessionResponseSchema>;
type RefreshSessionResponseInit = MessageInitShape<
  typeof RefreshSessionResponseSchema
>;
type CliAuthorizedDeviceAuthorizationInit = MessageInitShape<
  typeof CliAuthorizedDeviceAuthorizationSchema
>;

type CliAuthUserFields = {
  id?: string;
  email?: string;
  displayName?: string;
};

export const handleGetSession: CliServiceMethod<"getSession"> = async (
  request,
  context
) => {
  const c = requireCliConnectHonoContext(context);
  const readControls = parseCliFieldsReadControls(request, {
    allowedFields: SESSION_FIELDS,
  });
  const session = requireCliSessionIdentity(
    await resolveCliSessionIdentity(c.var.storage, c.req.raw.headers)
  );

  return projectCliSessionResponse(session, readControls.selectedFields);
};

export const handleRefreshSession: CliServiceMethod<"refreshSession"> = async (
  _request,
  context
) => {
  const c = requireCliConnectHonoContext(context);
  const session = requireCliSessionIdentity(
    await refreshCliSessionIdentity(c.var.storage, c.req.raw.headers)
  );

  return buildCliRefreshSession(session);
};

export const handleStartDeviceAuthorization: CliServiceMethod<
  "startDeviceAuthorization"
> = async (_request, context) => {
  const c = requireCliConnectHonoContext(context);
  const response = await c.var.storage.auth.handler(
    createAuthProxyRequest(c.req.raw, CLI_DEVICE_AUTH_CODE_PATH, {
      client_id: CLI_DEVICE_AUTH_CLIENT_ID,
    })
  );

  if (response.status === 200) {
    const payload = await readBetterAuthDeviceCodeResponse(response);
    const expiresInSec = payload.expires_in ?? CLI_DEFAULT_LOGIN_TIMEOUT_SEC;

    return {
      state: "pending",
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      ...buildDeviceVerificationUrls(
        c.var.runtime.auth.baseURL,
        payload.user_code
      ),
      pollAfterMs: deviceAuthorizationPollAfterMs(payload.interval),
      expiresAt: timestampFromDate(new Date(Date.now() + expiresInSec * 1000)),
    };
  }

  if (response.status === 400) {
    const payload = await readBetterAuthDeviceTokenErrorResponse(response);
    throwCliConnectError({
      detail: toCliDeviceAuthProblemDetail(payload),
      key: "INVALID_REQUEST",
    });
  }

  if (response.status === 429) {
    throwCliConnectError({
      detail: "device authorization start was rate-limited",
      key: "LOGIN_RATE_LIMITED",
      retryAfterMs: parseRetryAfterMs(response),
    });
  }

  throw new Error(
    `unexpected Better Auth response for ${CLI_DEVICE_AUTH_CODE_PATH}: ${response.status}`
  );
};

export const handlePollDeviceAuthorization: CliServiceMethod<
  "pollDeviceAuthorization"
> = async (request, context) => {
  const c = requireCliConnectHonoContext(context);
  const response = await c.var.storage.auth.handler(
    createAuthProxyRequest(c.req.raw, CLI_DEVICE_AUTH_TOKEN_PATH, {
      client_id: CLI_DEVICE_AUTH_CLIENT_ID,
      device_code: request.deviceCode,
      grant_type: CLI_DEVICE_AUTH_GRANT_TYPE,
    })
  );

  if (response.status === 200) {
    const payload = await readBetterAuthDeviceTokenSuccessResponse(response);
    const session = await resolveCliSessionIdentity(
      c.var.storage,
      createBearerHeaders(c.req.raw, payload.access_token)
    );

    return {
      outcome: {
        case: "authorized",
        value: buildAuthorizedDeviceAuthorizationResponse({
          accessToken: payload.access_token,
          session,
        }),
      },
    } satisfies MessageInitShape<typeof PollDeviceAuthorizationResponseSchema>;
  }

  if (response.status === 400) {
    const payload = await readBetterAuthDeviceTokenErrorResponse(response);

    if (payload.error === "authorization_pending") {
      return {
        outcome: {
          case: "pending",
          value: {
            state: "pending",
            pollAfterMs: CLI_DEFAULT_POLL_AFTER_MS,
          },
        },
      };
    }

    if (payload.error === "slow_down") {
      return {
        outcome: {
          case: "pending",
          value: {
            state: "pending",
            pollAfterMs: slowedDeviceAuthorizationPollAfterMs(),
          },
        },
      };
    }

    if (payload.error === "access_denied") {
      throwCliConnectError({
        detail:
          payload.error_description === undefined
            ? "device authorization was denied"
            : toCliDeviceAuthProblemDetail(payload),
        key: "LOGIN_DENIED",
      });
    }

    if (payload.error === "expired_token") {
      throwCliConnectError({
        detail:
          payload.error_description === undefined
            ? "device authorization session expired"
            : toCliDeviceAuthProblemDetail(payload),
        key: "LOGIN_SESSION_EXPIRED",
      });
    }

    throwCliConnectError({
      detail: toCliDeviceAuthProblemDetail(payload),
      key: "INVALID_REQUEST",
    });
  }

  if (response.status === 429) {
    throwCliConnectError({
      detail: "device authorization polling was rate-limited",
      key: "LOGIN_RATE_LIMITED",
      retryAfterMs: parseRetryAfterMs(response),
    });
  }

  throw new Error(
    `unexpected Better Auth response for ${CLI_DEVICE_AUTH_TOKEN_PATH}: ${response.status}`
  );
};

function buildCliAuthSessionUser(
  user: CliSessionIdentity["user"]
): CliAuthUserFields {
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
    user: buildCliAuthSessionUser(toCliAuthUserView(session.user)),
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
    user: buildCliAuthSessionUser(session.user),
    ...(session.activeOrg ? { activeOrgSlug: session.activeOrg } : {}),
    ...(session.issuedAt
      ? { issuedAt: timestampFromIsoString(session.issuedAt) }
      : {}),
    ...(session.expiresAt
      ? { expiresAt: timestampFromIsoString(session.expiresAt) }
      : {}),
  };
}

function projectCliSessionResponse(
  session: CliSessionIdentity,
  selectedFields: CliSelectedFields
): GetSessionResponseInit {
  const response = buildCliAuthSession(session);
  if (!selectedFields) {
    return response;
  }

  const projected: GetSessionResponseInit = {};
  if (selectedFields.has("authMode")) {
    projected.authMode = response.authMode;
  }

  const projectedUser = projectCliSessionUser(session.user, selectedFields);
  if (projectedUser) {
    projected.user = projectedUser;
  }

  if (selectedFields.has("activeOrgSlug") && session.activeOrg) {
    projected.activeOrgSlug = session.activeOrg;
  }
  if (selectedFields.has("issuedAt") && session.issuedAt) {
    projected.issuedAt = timestampFromIsoString(session.issuedAt);
  }
  if (selectedFields.has("expiresAt") && session.expiresAt) {
    projected.expiresAt = timestampFromIsoString(session.expiresAt);
  }

  return projected;
}

function projectCliSessionUser(
  user: CliSessionIdentity["user"],
  selectedFields: Exclude<CliSelectedFields, null>
): CliAuthUserFields | undefined {
  if (selectedFields.has("user")) {
    return buildCliAuthSessionUser(user);
  }

  const projected: CliAuthUserFields = {};
  if (selectedFields.has("user.id")) {
    projected.id = user.id;
  }
  if (selectedFields.has("user.email")) {
    projected.email = user.email;
  }
  if (selectedFields.has("user.displayName")) {
    projected.displayName = user.displayName;
  }

  return Object.keys(projected).length > 0 ? projected : undefined;
}

function buildAuthorizedDeviceAuthorizationResponse(input: {
  accessToken: string;
  session: CliSessionIdentity | null;
}): CliAuthorizedDeviceAuthorizationInit {
  const session = input.session;
  if (!session) {
    throwCliConnectError({
      detail:
        "device authorization completed, but no authenticated session could be resolved",
      key: "NOT_LOGGED_IN",
    });
  }

  return {
    state: "authorized",
    accessToken: input.accessToken,
    authMode: toCliAuthMode(session.authMode),
    user: buildCliAuthSessionUser(session.user),
    ...(session.activeOrg ? { activeOrgSlug: session.activeOrg } : {}),
    ...(session.issuedAt
      ? { issuedAt: timestampFromIsoString(session.issuedAt) }
      : {}),
    ...(session.expiresAt
      ? { expiresAt: timestampFromIsoString(session.expiresAt) }
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
