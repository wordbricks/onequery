import { createFactory } from "hono/factory";

import type { CliAuthDeviceAuthorizationStartContext } from "../../../generated/cli.context";
import type { CliAuthDeviceAuthorizationStartResponse } from "../../../generated/cli.schemas";
import { zValidator } from "../../../generated/cli.validator";
import { CliAuthDeviceAuthorizationStartResponse as CliAuthDeviceAuthorizationStartResponseSchema } from "../../../generated/cli.zod";
import type { CliRouteEnv } from "../../app";
import {
  createAuthProxyRequest,
  readBetterAuthDeviceCodeResponse,
  readBetterAuthDeviceTokenErrorResponse,
  toCliDeviceAuthProblemDetail,
  throwCliLoginRateLimitedProblem,
} from "../../auth/device-transport";
import {
  CLI_DEFAULT_LOGIN_TIMEOUT_SEC,
  CLI_DEVICE_AUTH_CLIENT_ID,
  CLI_DEVICE_AUTH_CODE_PATH,
  deviceAuthorizationPollAfterMs,
} from "../../cli-defaults";
import { throwCliProblem } from "../../error";
import { buildCliSuccessEnvelope } from "../envelope";

const factory = createFactory();

export const cliAuthDeviceAuthorizationStartHandlers = factory.createHandlers(
  zValidator("response", CliAuthDeviceAuthorizationStartResponseSchema),
  async (c: CliAuthDeviceAuthorizationStartContext<CliRouteEnv>) => {
    const response = await c.var.storage.auth.handler(
      createAuthProxyRequest(c.req.raw, CLI_DEVICE_AUTH_CODE_PATH, {
        client_id: CLI_DEVICE_AUTH_CLIENT_ID,
      })
    );

    if (response.status === 200) {
      const rawPayload = await readBetterAuthDeviceCodeResponse(response);
      const expiresInSec =
        rawPayload.expires_in ?? CLI_DEFAULT_LOGIN_TIMEOUT_SEC;
      const pollAfterMs = deviceAuthorizationPollAfterMs(rawPayload.interval);

      return c.json(
        buildCliSuccessEnvelope({
          data: {
            state: "pending",
            deviceCode: rawPayload.device_code,
            userCode: rawPayload.user_code,
            ...buildDeviceVerificationUrls(
              c.env.BETTER_AUTH_URL,
              rawPayload.user_code
            ),
            pollAfterMs,
            expiresAt: expiresAtFromNow(expiresInSec),
          } satisfies CliAuthDeviceAuthorizationStartResponse,
          requestId: c.var.requestId,
        }),
        200
      );
    }

    if (response.status === 400) {
      const payload = await readBetterAuthDeviceTokenErrorResponse(response);
      throwCliProblem({
        detail: toCliDeviceAuthProblemDetail(payload),
        key: "INVALID_REQUEST",
        stage: "auth",
      });
    }

    if (response.status === 429) {
      throwCliLoginRateLimitedProblem(
        response,
        "device authorization start was rate-limited"
      );
    }

    throw new Error(
      `Unexpected Better Auth response for ${CLI_DEVICE_AUTH_CODE_PATH}: ${response.status}`
    );
  }
);

export function buildDeviceVerificationUrls(baseUrl: string, userCode: string) {
  // Comment: verification links must use the configured public app origin rather
  // than the inbound Host header so the CLI never surfaces spoofed browser URLs.
  const resolvedBaseUrl = new URL(baseUrl);
  const verificationCompleteUrl = new URL("/device", resolvedBaseUrl);
  verificationCompleteUrl.searchParams.set("user_code", userCode);

  return {
    verificationCompleteUrl: verificationCompleteUrl.toString(),
    verificationUrl: new URL("/device", resolvedBaseUrl).toString(),
  };
}

function expiresAtFromNow(expiresInSec: number) {
  return new Date(Date.now() + expiresInSec * 1000).toISOString();
}
