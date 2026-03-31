import {
  createCliRoute,
  createDeviceAuthorizationBrowserRoute,
} from "@onequery/cli-server";
import { createServerApi } from "@onequery/server/app";
import { sessionMiddleware } from "@onequery/server/middleware/session";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import {
  createServerStorage,
  serverStorageMiddleware,
  type ServerStorage,
} from "@onequery/server/storage";
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

type SpaAssetBinding = {
  fetch: (request: Request) => Promise<Response>;
};

export interface CreateBunAppOptions {
  enableAuthTestUtils?: boolean;
  runtime: ServerRuntimeConfig;
  spaAssets: SpaAssetBinding;
  storage?: ServerStorage;
}

function apiLogger(message: string, ...rest: string[]): void {
  console.log("[api]", message, ...rest);
}

function resolveStorage(input: CreateBunAppOptions): ServerStorage {
  return (
    input.storage ??
    createServerStorage(input.runtime, {
      enableAuthTestUtils: input.enableAuthTestUtils,
    })
  );
}

// Build the runtime API surface on top of the shared OSS-safe server routes.
export function createApiApp(input: CreateBunAppOptions) {
  const storage = resolveStorage(input);

  return new Hono()
    .use("*", logger(apiLogger))
    // The runtime package owns the public `/api` mount and top-level API
    // composition. Deployment adapters can import this app without redefining
    // the route graph.
    .route(
      API_ROUTE_PREFIX,
      createServerApi({
        enableAuthTestUtils: input.enableAuthTestUtils,
        runtime: input.runtime,
        storage,
      })
    )
    .route(
      DEVICE_AUTHORIZATION_API_ROUTE_PREFIX,
      createDeviceAuthorizationBrowserRoute({
        runtime: input.runtime,
        storage,
      })
    )
    .route(
      CLI_API_ROUTE_PREFIX,
      createCliRoute({
        runtime: input.runtime,
        storage,
      })
    )
    .use(BUDGET_API_ROUTE_PREFIX, serverStorageMiddleware(storage))
    .use(`${BUDGET_API_ROUTE_PREFIX}/*`, serverStorageMiddleware(storage))
    .use(BUDGET_API_ROUTE_PREFIX, sessionMiddleware())
    .use(`${BUDGET_API_ROUTE_PREFIX}/*`, sessionMiddleware())
    .route(BUDGET_API_ROUTE_PREFIX, budgetRoute);
}

export function createApp(input: CreateBunAppOptions) {
  const apiApp = createApiApp(input);

  return new Hono()
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

      return input.spaAssets.fetch(c.req.raw);
    });
}

export type ApiType = ReturnType<typeof createApiApp>;
