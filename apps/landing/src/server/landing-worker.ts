import { createContextValues } from "@connectrpc/connect";
import { createValidateInterceptor } from "@connectrpc/validate";

import { LANDING_CONNECT_PATH_PREFIX } from "../landing-api";
import { landingContextKey, registerLandingRoutes } from "./landing-service";
import { createWorkerHandler } from "./worker-handler";

export interface LandingWorkerBindings {
  LANDING_SLACK_WEBHOOK_URL?: string;
}

export function createLandingWorkerHandler() {
  return createWorkerHandler<LandingWorkerBindings>({
    connect: true,
    grpc: false,
    grpcWeb: false,
    interceptors: [createValidateInterceptor()],
    requestPathPrefix: LANDING_CONNECT_PATH_PREFIX,
    routes: registerLandingRoutes,
    contextValues(_request, env) {
      return createContextValues().set(landingContextKey, {
        slackWebhookUrl: env.LANDING_SLACK_WEBHOOK_URL?.trim() || null,
      });
    },
  });
}
