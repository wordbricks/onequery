import { createContextValues } from "@connectrpc/connect";
import { createValidateInterceptor } from "@connectrpc/validate";

import { createWorkerHandler } from "../rpc/worker-handler";
import { landingContextKey, registerLandingRoutes } from "./landing-service";
import type { LandingNotificationDelivery } from "./landing-service";

export interface LandingWorkerBindings {
  // Comment: local dev can intentionally omit the webhook binding and use the
  // loopback fallback sink, but deployed environments still require it.
  LANDING_SLACK_WEBHOOK_URL?: string;
}

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

export function createLandingWorkerHandler() {
  return createWorkerHandler<LandingWorkerBindings>({
    connect: true,
    grpc: false,
    grpcWeb: false,
    interceptors: [createValidateInterceptor()],
    routes: registerLandingRoutes,
    contextValues(request, env) {
      const url = new URL(request.url);
      return createContextValues().set(landingContextKey, {
        notificationDelivery: resolveLandingNotificationDelivery({
          hostname: url.hostname,
          slackWebhookUrl: env.LANDING_SLACK_WEBHOOK_URL,
        }),
      });
    },
  });
}
