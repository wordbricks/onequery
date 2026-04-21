import { zValidator } from "@hono/zod-validator";
import type { Context, TypedResponse } from "hono";
import { Hono } from "hono";
import { problemDetails, problemDetailsHandler } from "hono-problem-details";
import { zodProblemHook as createProblemDetailsZodHook } from "hono-problem-details/zod";
import type { ZodProblemHookOptions } from "hono-problem-details/zod";
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

export type LandingValidationError = {
  code?: string;
  field: string;
  message: string;
};

type LandingProblemResponseBase<Status extends number> = {
  detail?: string;
  instance?: string;
  status: Status;
  title: string;
  type: string;
};

export type LandingValidationProblemResponse =
  LandingProblemResponseBase<422> & {
    errors: readonly LandingValidationError[];
  };

export type LandingInternalProblemResponse = LandingProblemResponseBase<500>;

export type LandingServiceUnavailableProblemResponse =
  LandingProblemResponseBase<503>;

export type LandingProductUpdatesResponse = {
  email: string;
};

function zodProblemHook(options?: ZodProblemHookOptions) {
  const hook = createProblemDetailsZodHook(options);

  return (
    result: unknown,
    c: Context
  ): TypedResponse<LandingValidationProblemResponse, 422, "json"> | undefined =>
    // Comment: upstream 0.4.0 fixes the runtime path for Zod v4, but the
    // exported hook type still widens the response enough to erase RPC output
    // inference, so we keep the runtime behavior and restore the concrete 422
    // problem-details response type locally.
    hook(result as Parameters<typeof hook>[0], c) as
      | TypedResponse<LandingValidationProblemResponse, 422, "json">
      | undefined;
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

function createLandingBaseApp() {
  return new Hono<LandingAppEnv>()
    .basePath("/api")
    .onError(problemDetailsHandler());
}

function registerLandingRoutes(
  app: ReturnType<typeof createLandingBaseApp>,
  notificationRuntime: LandingNotificationRuntime
) {
  return app
    .post(
      "/product-updates",
      zValidator("json", ProductUpdatesRequestSchema, zodProblemHook()),
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
        return c.json<LandingProductUpdatesResponse, 200>(
          { email: normalizedEmail },
          200
        );
      }
    )
    .post(
      "/contact",
      zValidator("json", ContactRequestSchema, zodProblemHook()),
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
        return c.json<Record<never, never>, 200>({}, 200);
      }
    );
}

const landingAppTypeSurface = registerLandingRoutes(
  createLandingBaseApp(),
  defaultLandingNotificationRuntime
);

export function createLandingApp(options: CreateLandingAppOptions = {}) {
  const notificationRuntime =
    options.notificationRuntime ?? defaultLandingNotificationRuntime;

  return registerLandingRoutes(createLandingBaseApp(), notificationRuntime);
}

export type LandingApp = typeof landingAppTypeSurface;
