import { createContextValues } from "@connectrpc/connect";
import { createValidateInterceptor } from "@connectrpc/validate";

import { landingContextKey, registerLandingRoutes } from "./landing-service";
import { createWorkerHandler } from "./worker-handler";

export interface LandingWorkerBindings {
  // Comment: local and preview environments can intentionally omit the
  // webhook binding, and the RPC layer surfaces that as Unavailable.
  LANDING_SLACK_WEBHOOK_URL?: string;
}

export function createLandingWorkerHandler() {
  return createWorkerHandler<LandingWorkerBindings>({
    connect: true,
    grpc: false,
    grpcWeb: false,
    interceptors: [createValidateInterceptor()],
    routes: registerLandingRoutes,
    contextValues(_request, env) {
      return createContextValues().set(landingContextKey, {
        slackWebhookUrl: env.LANDING_SLACK_WEBHOOK_URL?.trim() || null,
      });
    },
  });
}
