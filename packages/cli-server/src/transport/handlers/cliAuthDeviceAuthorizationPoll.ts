import { createFactory } from "hono/factory";

import type { CliAuthDeviceAuthorizationPollContext } from "../../../generated/cli.context";
import type {
  CliAuthDeviceAuthorizationPendingResponse,
  CliAuthDeviceAuthorizationSuccessResponse,
} from "../../../generated/cli.schemas";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliAuthDeviceAuthorizationPollBody,
  CliAuthDeviceAuthorizationPollResponse,
} from "../../../generated/cli.zod";
import type { CliRouteEnv } from "../../app";
import {
  createAuthProxyRequest,
  createBearerHeaders,
  readBetterAuthDeviceTokenErrorResponse,
  readBetterAuthDeviceTokenSuccessResponse,
  toCliDeviceAuthProblemDetail,
  throwCliLoginRateLimitedProblem,
} from "../../auth/device-transport";
import { resolveCliSessionIdentity } from "../../auth/session-identity";
import {
  CLI_DEFAULT_POLL_AFTER_MS,
  CLI_DEVICE_AUTH_CLIENT_ID,
  CLI_DEVICE_AUTH_GRANT_TYPE,
  CLI_DEVICE_AUTH_TOKEN_PATH,
  slowedDeviceAuthorizationPollAfterMs,
} from "../../cli-defaults";
import type { CliSessionIdentity } from "../../domain/workflows";
import { throwCliProblem } from "../../error";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";

const factory = createFactory();

export function buildAuthorizedDeviceAuthorizationResponse(input: {
  accessToken: string;
  session: CliSessionIdentity | null;
}): CliAuthDeviceAuthorizationSuccessResponse {
  const session = input.session;
  if (!session) {
    // Comment: token exchange and session lookup are separate auth backend
    // calls, so surface a missing resolved session as a stable CLI auth problem
    // instead of leaking an uncaught handler error.
    throwCliProblem({
      detail:
        "device authorization completed, but no authenticated session could be resolved",
      hint: "run `oneq auth login` again",
      key: "NOT_LOGGED_IN",
    });
  }

  return {
    state: "authorized",
    accessToken: input.accessToken,
    authMode: session.authMode,
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
    },
    activeOrgSlug: session.activeOrg,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  };
}

export const cliAuthDeviceAuthorizationPollHandlers = factory.createHandlers(
  zValidator(
    "json",
    CliAuthDeviceAuthorizationPollBody,
    createCliValidationHook({
      defaultMessage: "invalid device authorization polling request",
      defaultStage: "auth",
      fieldStages: {
        deviceCode: "auth",
      },
      hint: "correct the request body and retry",
    })
  ),
  zValidator("response", CliAuthDeviceAuthorizationPollResponse),
  async (c: CliAuthDeviceAuthorizationPollContext<CliRouteEnv>) => {
    const payload = c.req.valid("json");
    const response = await c.var.storage.auth.handler(
      createAuthProxyRequest(c.req.raw, CLI_DEVICE_AUTH_TOKEN_PATH, {
        client_id: CLI_DEVICE_AUTH_CLIENT_ID,
        device_code: payload.deviceCode,
        grant_type: CLI_DEVICE_AUTH_GRANT_TYPE,
      })
    );

    if (response.status === 200) {
      const rawPayload =
        await readBetterAuthDeviceTokenSuccessResponse(response);
      const session = await resolveCliSessionIdentity(
        c.var.storage,
        createBearerHeaders(c.req.raw, rawPayload.access_token)
      );

      return c.json(
        buildCliSuccessEnvelope({
          data: buildAuthorizedDeviceAuthorizationResponse({
            accessToken: rawPayload.access_token,
            session,
          }),
          requestId: c.var.requestId,
        }),
        200
      );
    }

    if (response.status === 400) {
      const errorPayload =
        await readBetterAuthDeviceTokenErrorResponse(response);

      if (errorPayload.error === "authorization_pending") {
        return c.json(
          buildCliSuccessEnvelope({
            data: {
              state: "pending",
              pollAfterMs: CLI_DEFAULT_POLL_AFTER_MS,
            } satisfies CliAuthDeviceAuthorizationPendingResponse,
            requestId: c.var.requestId,
          }),
          200
        );
      }

      if (errorPayload.error === "slow_down") {
        return c.json(
          buildCliSuccessEnvelope({
            data: {
              state: "pending",
              pollAfterMs: slowedDeviceAuthorizationPollAfterMs(),
            } satisfies CliAuthDeviceAuthorizationPendingResponse,
            requestId: c.var.requestId,
          }),
          200
        );
      }

      if (errorPayload.error === "access_denied") {
        throwCliProblem({
          detail:
            errorPayload.error_description === undefined
              ? "device authorization was denied"
              : toCliDeviceAuthProblemDetail(errorPayload),
          key: "LOGIN_DENIED",
        });
      }

      if (errorPayload.error === "expired_token") {
        throwCliProblem({
          detail:
            errorPayload.error_description === undefined
              ? "device authorization session expired"
              : toCliDeviceAuthProblemDetail(errorPayload),
          key: "LOGIN_SESSION_EXPIRED",
        });
      }

      throwCliProblem({
        detail: toCliDeviceAuthProblemDetail(errorPayload),
        key: "INVALID_REQUEST",
        stage: "auth",
      });
    }

    if (response.status === 429) {
      throwCliLoginRateLimitedProblem(
        response,
        "device authorization polling was rate-limited"
      );
    }

    throw new Error(
      `Unexpected Better Auth response for ${CLI_DEVICE_AUTH_TOKEN_PATH}: ${response.status}`
    );
  }
);
