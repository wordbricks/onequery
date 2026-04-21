import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { problemDetails, problemDetailsHandler } from "hono-problem-details";
import { z } from "zod";

import {
  createContactNotification,
  createProductUpdatesNotification,
  defaultLandingNotificationRuntime,
  deliverLandingNotification,
  LandingNotificationConfigurationError,
} from "./landing-notifications";
import type {
  LandingNotificationDelivery,
  LandingNotificationError,
  LandingNotificationRuntime,
} from "./landing-notifications";

export interface LandingWorkerBindings {
  // Local dev can intentionally omit the webhook binding and use the loopback
  // fallback sink, but deployed environments still require it.
  LANDING_SLACK_WEBHOOK_URL?: string;
}

export type LandingAppEnv = {
  Bindings: LandingWorkerBindings;
};

export const ProductUpdatesRequestSchema = z.object({
  email: z.email("email must be a valid email address").max(320),
});

export const ContactRequestSchema = z.object({
  name: z.string().min(1, "name is required").max(200),
  email: z.email("email must be a valid email address").max(320),
  message: z.string().min(1, "message is required").max(4000),
});

type ZodValidationIssue = {
  path: readonly PropertyKey[];
  message: string;
  code?: string;
};

type ZodValidationFailure = {
  issues: readonly ZodValidationIssue[];
};

function zodProblemHook(
  result:
    | { success: true; data: unknown }
    | { success: false; error: ZodValidationFailure; data: unknown },
  _c: Context
): void {
  if (result.success) {
    return;
  }

  throw problemDetails({
    detail: "Request validation failed",
    extensions: {
      errors: result.error.issues.map((issue) => ({
        code: issue.code ?? "invalid",
        field: issue.path.map((part) => String(part)).join("."),
        message: issue.message,
      })),
    },
    status: 422,
    title: "Validation Error",
  });
}

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

function resolveDelivery(c: Context<LandingAppEnv>) {
  return resolveLandingNotificationDelivery({
    hostname: new URL(c.req.url).hostname,
    slackWebhookUrl: c.env.LANDING_SLACK_WEBHOOK_URL,
  });
}

function notificationProblem(error: LandingNotificationError) {
  if (LandingNotificationConfigurationError.is(error)) {
    return problemDetails({
      detail: error.message,
      status: 503,
      title: "Service Unavailable",
    });
  }

  return problemDetails({
    detail: "Failed to deliver notification",
    status: 503,
    title: "Service Unavailable",
  });
}

export interface CreateLandingAppOptions {
  notificationRuntime?: LandingNotificationRuntime;
}

export function createLandingApp(options: CreateLandingAppOptions = {}) {
  const notificationRuntime =
    options.notificationRuntime ?? defaultLandingNotificationRuntime;

  return new Hono<LandingAppEnv>()
    .basePath("/api")
    .onError(problemDetailsHandler())
    .post(
      "/product-updates",
      zValidator("json", ProductUpdatesRequestSchema, zodProblemHook),
      async (c) => {
        const { email } = c.req.valid("json");
        const normalizedEmail = email.trim().toLowerCase();
        const result = await deliverLandingNotification(
          {
            delivery: resolveDelivery(c),
            payload: createProductUpdatesNotification(normalizedEmail),
          },
          notificationRuntime
        );
        if (result.isErr()) {
          throw notificationProblem(result.error);
        }
        return c.json({ email: normalizedEmail });
      }
    )
    .post(
      "/contact",
      zValidator("json", ContactRequestSchema, zodProblemHook),
      async (c) => {
        const { email, message, name } = c.req.valid("json");
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedName = name.trim();
        const normalizedMessage = message.trim();
        const result = await deliverLandingNotification(
          {
            delivery: resolveDelivery(c),
            payload: createContactNotification({
              email: normalizedEmail,
              message: normalizedMessage,
              name: normalizedName,
            }),
          },
          notificationRuntime
        );
        if (result.isErr()) {
          throw notificationProblem(result.error);
        }
        return c.json({});
      }
    );
}

export type LandingApp = ReturnType<typeof createLandingApp>;
