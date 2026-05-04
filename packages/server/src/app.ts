import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";

import { createMemoryApiRateLimitStorage } from "./lib/rate-limit-storage";
import { betterAuthSessionMiddleware } from "./middleware/better-auth-session";
import type { BetterAuthSessionVariables } from "./middleware/better-auth-session";
import { apiRateLimiter } from "./middleware/rate-limit";
import { createProblemDetailsErrorHandler } from "./observability/error-reporting";
import {
  buildHonoRequestLogDetails,
  createHonoRequestStructuredLogger,
} from "./observability/structured-logging";
import type { HonoStructuredLoggerVariables } from "./observability/structured-logging";
import { authRoute } from "./routes/auth";
import { bootstrapRoute } from "./routes/bootstrap";
import { budgetRoute } from "./routes/budget";
import { connectorJobsRoute, connectorsRoute } from "./routes/connectors";
import { dataSourcesRoute } from "./routes/data-sources";
import { healthRoute } from "./routes/health";
import { organizationsRoute } from "./routes/organizations";
import { statsRoute } from "./routes/stats";
import { teamRoute } from "./routes/team";
import type { ServerRuntimeConfig } from "./runtime";
import { serverRuntimeMiddleware } from "./runtime-context";
import type { ServerRuntimeVariables } from "./runtime-context";
import { createServerStorage, serverStorageMiddleware } from "./storage";
import type { ServerStorage } from "./storage";

export type { BetterAuthSessionVariables } from "./middleware/better-auth-session";

type ServerApiVariables = RequestIdVariables &
  ServerRuntimeVariables &
  BetterAuthSessionVariables &
  HonoStructuredLoggerVariables;

export interface CreateServerApiOptions {
  enableAuthTestUtils?: boolean;
  runtime: ServerRuntimeConfig;
  storage?: ServerStorage;
}

type ServerApiEnv = {
  Variables: ServerApiVariables;
};

const dashboardApiStructuredLogger =
  createHonoRequestStructuredLogger<ServerApiEnv>({
    buildErrorDetails: (error, c) => ({
      err: error,
      status: c.res.status,
    }),
    buildRequestDetails: (c) =>
      buildHonoRequestLogDetails(c, {
        requestId: c.var.requestId,
      }),
    buildResponseDetails: (c, elapsedMs) => ({
      elapsedMs,
      status: c.res.status,
    }),
    events: {
      completed: "dashboard.request.completed",
      failed: "dashboard.request.failed",
      started: "dashboard.request.started",
    },
    messages: {
      completed: "dashboard request completed",
      failed: "dashboard request failed",
      started: "dashboard request started",
    },
    scope: "dashboard",
  });

/**
 * Shared OSS-safe control-plane routes.
 * The caller owns the public mount point and request-id middleware.
 */
export function createServerApiRoutes(input: CreateServerApiOptions) {
  const storage =
    input.storage ??
    createServerStorage(input.runtime, createMemoryApiRateLimitStorage(), {
      enableAuthTestUtils: input.enableAuthTestUtils,
    });

  return (
    new Hono<ServerApiEnv>()
      .onError(
        createProblemDetailsErrorHandler(
          "packages/server/createServerApiRoutes"
        )
      )
      // Comment: apps/dashboard is a client app; its Hono API surface lives
      // here and is mounted by the self-host runtime under `/api`.
      .use("*", dashboardApiStructuredLogger)
      .use("*", serverRuntimeMiddleware(input.runtime))
      .use("*", serverStorageMiddleware(storage))
      // Rate limiting (applied first to reject requests early)
      .use("*", apiRateLimiter({ enabled: input.runtime.rateLimit.enabled }))
      // Better Auth session resolver for protected routes
      .use("/organizations", betterAuthSessionMiddleware())
      .use("/organizations/*", betterAuthSessionMiddleware())
      .use("/stats", betterAuthSessionMiddleware())
      .use("/stats/*", betterAuthSessionMiddleware())
      .use("/team", betterAuthSessionMiddleware())
      .use("/team/*", betterAuthSessionMiddleware())
      .use("/data-sources", betterAuthSessionMiddleware())
      .use("/data-sources/*", betterAuthSessionMiddleware())
      .use("/budget", betterAuthSessionMiddleware())
      .use("/budget/*", betterAuthSessionMiddleware())
      .route("/", healthRoute)
      .route("/bootstrap", bootstrapRoute)
      .route("/budget", budgetRoute)
      .route("/connectors", connectorsRoute)
      .route("/jobs", connectorJobsRoute)
      .route("/auth", authRoute)
      .route("/data-sources", dataSourcesRoute)
      .route("/organizations", organizationsRoute)
      .route("/stats", statsRoute)
      .route("/team", teamRoute)
  );
}

export function createServerApiApp(input: CreateServerApiOptions) {
  return new Hono<ServerApiEnv>()
    .use("*", requestId())
    .route("/", createServerApiRoutes(input));
}

export type ServerApiRoutesType = ReturnType<typeof createServerApiRoutes>;
export type ServerApiType = ReturnType<typeof createServerApiApp>;
