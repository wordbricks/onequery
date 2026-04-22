import {
  createCliRoute,
  createDeviceAuthorizationBrowserRoute,
} from "@onequery/cli-server";
import {
  createInstallScriptResponse,
  shouldServeInstallScript,
} from "@onequery/installer";
import { createServerApi } from "@onequery/server/app";
import { createMemoryApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import { createServerStorage } from "@onequery/server/storage";
import type { ServerStorage } from "@onequery/server/storage";
import { Hono } from "hono";
import { problemDetailsHandler } from "hono-problem-details";
import { logger } from "hono/logger";

import {
  API_ROUTE_PREFIX,
  CLI_API_ROUTE_PREFIX,
  DEVICE_AUTHORIZATION_API_ROUTE_PREFIX,
  isApiRoutePath,
} from "./constants";

type SpaAssetBinding = {
  fetch: (request: Request) => Promise<Response>;
};

export interface CreateRuntimeAppOptions {
  enableAuthTestUtils?: boolean;
  runtime: ServerRuntimeConfig;
  spaAssets: SpaAssetBinding;
  storage?: ServerStorage;
}

function apiLogger(message: string, ...rest: string[]): void {
  console.log("[api]", message, ...rest);
}

function resolveStorage(input: CreateRuntimeAppOptions): ServerStorage {
  return (
    input.storage ??
    createServerStorage(input.runtime, createMemoryApiRateLimitStorage(), {
      enableAuthTestUtils: input.enableAuthTestUtils,
    })
  );
}

// Build the runtime API surface on top of the shared OSS-safe server routes.
export function createApiApp(input: CreateRuntimeAppOptions) {
  const storage = resolveStorage(input);

  return (
    new Hono()
      .use("*", logger(apiLogger))
      // Comment: mount the more specific `/api/*` children before the broad
      // `/api` app so Hono does not run the general control-plane middleware
      // for CLI or device-authorization requests.
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
          requestPathPrefix: CLI_API_ROUTE_PREFIX,
          runtime: input.runtime,
          storage,
        })
      )
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
  );
}

export function createApp(input: CreateRuntimeAppOptions) {
  const apiApp = createApiApp(input);

  return (
    new Hono()
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
      })
  );
}

export type ApiType = ReturnType<typeof createApiApp>;
