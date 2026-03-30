import {
  cliRoute,
  deviceAuthorizationBrowserRoute,
} from "@onequery/cli-server";
import { serverApiRoutes } from "@onequery/server/app";
import { parseCoreServerEnv } from "@onequery/server/env";
import { sessionMiddleware } from "@onequery/server/middleware/session";
import { serverStorageMiddleware } from "@onequery/server/storage";
import { Hono } from "hono";
import { problemDetailsHandler } from "hono-problem-details";
import { logger } from "hono/logger";

import {
  API_ROUTE_PREFIX,
  BUDGET_API_ROUTE_PREFIX,
  CLI_API_ROUTE_PREFIX,
  DEVICE_AUTHORIZATION_API_ROUTE_PREFIX,
  isApiRoutePath,
} from "./constants";
import {
  createInstallScriptResponse,
  shouldServeInstallScript,
} from "./install-script";
import { budgetRoute } from "./routes/budget/route";
import type { BunRuntimeEnv } from "./runtime-env";
export type { BunRuntimeEnv } from "./runtime-env";

function apiLogger(message: string, ...rest: string[]): void {
  console.log("[api]", message, ...rest);
}

// Build the runtime API surface on top of the shared OSS-safe server routes.
export const apiApp = new Hono<{ Bindings: BunRuntimeEnv }>()
  .use("*", logger(apiLogger))
  .use(`${API_ROUTE_PREFIX}/*`, async (c, next) => {
    // Comment: Validate the shared local/runtime env contract at the API edge
    // so setup errors fail before route-specific logic starts running.
    parseCoreServerEnv(c.env);
    await next();
  })
  // The runtime package owns the public `/api` mount and top-level API
  // composition. Deployment adapters can import this app without redefining
  // the route graph.
  .route(API_ROUTE_PREFIX, serverApiRoutes)
  .route(DEVICE_AUTHORIZATION_API_ROUTE_PREFIX, deviceAuthorizationBrowserRoute)
  .route(CLI_API_ROUTE_PREFIX, cliRoute)
  .use(BUDGET_API_ROUTE_PREFIX, serverStorageMiddleware())
  .use(`${BUDGET_API_ROUTE_PREFIX}/*`, serverStorageMiddleware())
  .use(BUDGET_API_ROUTE_PREFIX, sessionMiddleware())
  .use(`${BUDGET_API_ROUTE_PREFIX}/*`, sessionMiddleware())
  .route(BUDGET_API_ROUTE_PREFIX, budgetRoute);

export const app = new Hono<{ Bindings: BunRuntimeEnv }>()
  .onError(problemDetailsHandler())
  .route("/", apiApp)
  // Removed/private API endpoints should fail as API 404s instead of serving
  // the SPA shell through the assets binding.
  .notFound(async (c) => {
    if (isApiRoutePath(c.req.path)) {
      return c.text("404 Not Found", 404);
    }

    if (shouldServeInstallScript(c.req.raw)) {
      return createInstallScriptResponse(c.req.raw);
    }

    return c.env.SPA_ASSETS.fetch(c.req.raw);
  });

export type ApiType = typeof apiApp;
