import {
  createCliConnectRoutes,
  createDeviceAuthorizationBrowserRoutes,
} from "@onequery/cli-server";
import {
  createInstallScriptResponse,
  shouldServeInstallScript,
} from "@onequery/installer";
import { createServerApiRoutes } from "@onequery/server/app";
import { createMemoryApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import {
  buildHonoRequestLogDetails,
  createHonoRequestStructuredLogger,
} from "@onequery/server/observability/structured-logging";
import type { HonoStructuredLoggerVariables } from "@onequery/server/observability/structured-logging";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import { createServerStorage } from "@onequery/server/storage";
import type { ServerStorage } from "@onequery/server/storage";
import { Hono } from "hono";
import { problemDetailsHandler } from "hono-problem-details";
import { requestId } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";

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

type RuntimeApiEnv = {
  Variables: RequestIdVariables;
};

type RuntimeAppEnv = {
  Variables: RequestIdVariables & HonoStructuredLoggerVariables;
};

function resolveStorage(input: CreateRuntimeAppOptions): ServerStorage {
  return (
    input.storage ??
    createServerStorage(input.runtime, createMemoryApiRateLimitStorage(), {
      enableAuthTestUtils: input.enableAuthTestUtils,
    })
  );
}

const selfHostRuntimeStructuredLogger =
  createHonoRequestStructuredLogger<RuntimeAppEnv>({
    buildRequestDetails: (c) =>
      buildHonoRequestLogDetails(c, {
        requestId: c.var.requestId,
      }),
    events: {
      completed: "runtime.request.completed",
      failed: "runtime.request.failed",
      started: "runtime.request.started",
    },
    messages: {
      completed: "runtime request completed",
      failed: "runtime request failed",
      started: "runtime request started",
    },
    scope: "self-host-runtime",
  });

// Build the runtime API surface on top of shared mountable route graphs.
export function createRuntimeApiRoutes(input: CreateRuntimeAppOptions) {
  const storage = resolveStorage(input);

  return (
    new Hono<RuntimeApiEnv>()
      // Comment: mount the more specific `/api/*` children before the broad
      // `/api` app so Hono does not run the general control-plane middleware
      // for CLI or device-authorization requests.
      .route(
        DEVICE_AUTHORIZATION_API_ROUTE_PREFIX,
        createDeviceAuthorizationBrowserRoutes({
          runtime: input.runtime,
          storage,
        })
      )
      .route(
        CLI_API_ROUTE_PREFIX,
        createCliConnectRoutes({
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
        createServerApiRoutes({
          enableAuthTestUtils: input.enableAuthTestUtils,
          runtime: input.runtime,
          storage,
        })
      )
  );
}

// Build a standalone API app for callers that only serve the `/api` surface.
export function createApiApp(input: CreateRuntimeAppOptions) {
  return new Hono<RuntimeApiEnv>()
    .use("*", requestId())
    .route("/", createRuntimeApiRoutes(input));
}

export function createApp(input: CreateRuntimeAppOptions) {
  const apiRoutes = createRuntimeApiRoutes(input);

  return (
    new Hono<RuntimeAppEnv>()
      .use("*", requestId())
      .use("*", selfHostRuntimeStructuredLogger)
      .onError(problemDetailsHandler())
      .route("/", apiRoutes)
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

export type RuntimeApiRoutesType = ReturnType<typeof createRuntimeApiRoutes>;
export type ApiType = ReturnType<typeof createApiApp>;
