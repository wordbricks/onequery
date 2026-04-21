import type { Context, TypedResponse } from "hono";

import { LandingNotificationConfigurationError } from "../../landing/landing-notifications";
import type {
  LandingNotificationDelivery,
  LandingNotificationError,
} from "../../landing/landing-notifications";
import type { LandingAppEnv } from "../../types";

type LandingErrorResponseBase<Code extends string> = {
  code: Code;
  message: string;
};

export type LandingInternalErrorResponse =
  LandingErrorResponseBase<"internal_error">;

export type LandingServiceUnavailableErrorResponse =
  LandingErrorResponseBase<"service_unavailable">;

export type LandingProductUpdatesResponse = {
  email: string;
};

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

export function resolveLandingNotificationDelivery(input: {
  hostname: string;
  slackWebhookUrl: string | undefined;
}): LandingNotificationDelivery {
  const webhookUrl = input.slackWebhookUrl?.trim();
  if (webhookUrl) {
    return {
      kind: "slack-webhook",
      webhookUrl,
    };
  }

  if (isLoopbackHostname(input.hostname)) {
    return {
      kind: "local-dev-null-sink",
    };
  }

  return {
    kind: "unconfigured",
  };
}

export function resolveLandingNotificationDeliveryFromContext(
  c: Context<LandingAppEnv>
) {
  return resolveLandingNotificationDelivery({
    hostname: new URL(c.req.url).hostname,
    slackWebhookUrl: c.env.LANDING_SLACK_WEBHOOK_URL,
  });
}

export function notificationProblem(
  c: Context<LandingAppEnv>,
  error: LandingNotificationError
): TypedResponse<LandingServiceUnavailableErrorResponse, 503, "json"> {
  const message = LandingNotificationConfigurationError.is(error)
    ? error.message
    : "Failed to deliver notification";

  return c.json<LandingServiceUnavailableErrorResponse, 503>(
    {
      code: "service_unavailable",
      message,
    },
    503
  );
}
