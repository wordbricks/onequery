import { createContextValues } from "@connectrpc/connect";
import { Hono } from "hono";

import { honoConnectMiddleware } from "./connect-hono";
import { landingContextKey, registerLandingRoutes } from "./landing-service";

export interface LandingAppEnv {
  Bindings: {
    LANDING_SLACK_WEBHOOK_URL?: string;
  };
}

export const LANDING_CONNECT_PATH_PREFIX = "/api" as const;

export function createLandingApp() {
  const app = new Hono<LandingAppEnv>();

  app.use(
    `${LANDING_CONNECT_PATH_PREFIX}/*`,
    honoConnectMiddleware<LandingAppEnv>({
      requestPathPrefix: LANDING_CONNECT_PATH_PREFIX,
      routes: registerLandingRoutes,
      contextValues(c) {
        return createContextValues().set(landingContextKey, {
          slackWebhookUrl: c.env.LANDING_SLACK_WEBHOOK_URL?.trim() || null,
        });
      },
    })
  );

  return app;
}
