import { zValidator } from "@hono/zod-validator";
import type { Context, TypedResponse, ValidationTargets } from "hono";
import type { z } from "zod";

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

export type LandingValidationErrorResponse =
  LandingErrorResponseBase<"validation_error"> & {
    fieldErrors: Record<string, string[]>;
  };

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

function resolveLandingNotificationDelivery(input: {
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

type LandingValidationIssue = {
  message: string;
  path: readonly PropertyKey[];
};

type LandingValidationError = {
  issues: readonly LandingValidationIssue[];
};

function readLandingValidationFieldKey(path: readonly PropertyKey[]) {
  if (path.length === 0) {
    return "_form";
  }

  return path.map(String).join(".");
}

function readLandingValidationErrorResponse(error: LandingValidationError) {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const fieldKey = readLandingValidationFieldKey(issue.path);
    const existingMessages = fieldErrors[fieldKey] ?? [];

    fieldErrors[fieldKey] = [...existingMessages, issue.message];
  }

  const message = error.issues[0]?.message ?? "Invalid request";

  return {
    code: "validation_error" as const,
    fieldErrors,
    message,
  };
}

export function landingValidator<
  T extends z.ZodType,
  Target extends keyof ValidationTargets,
>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) {
      return;
    }

    return c.json<LandingValidationErrorResponse, 400>(
      readLandingValidationErrorResponse(result.error),
      400
    );
  });
}

export function notificationServiceUnavailableResponse(
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
