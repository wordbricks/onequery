import { createContextValues } from "@connectrpc/connect";
import { createValidateInterceptor } from "@connectrpc/validate";

import { createWorkerHandler } from "../rpc/worker-handler";
import { landingContextKey, registerLandingRoutes } from "./landing-service";

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
        allowLocalNotificationFallback: isLoopbackHostname(url.hostname),
        slackWebhookUrl: env.LANDING_SLACK_WEBHOOK_URL?.trim() || null,
      });
    },
  });
}
