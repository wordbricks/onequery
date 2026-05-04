import { structuredLogger } from "@hono/structured-logger";
import type { BaseLogger } from "@hono/structured-logger";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";

import { createMemoryApiRateLimitStorage } from "./lib/rate-limit-storage";
import { apiRateLimiter } from "./middleware/rate-limit";
import { sessionMiddleware } from "./middleware/session";
import type { SessionVariables } from "./middleware/session";
import { createProblemDetailsErrorHandler } from "./observability/error-reporting";
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

export type { SessionVariables } from "./middleware/session";

type ServerApiVariables = RequestIdVariables &
  ServerRuntimeVariables &
  SessionVariables & {
    logger: BaseLogger;
  };

export interface CreateServerApiOptions {
  enableAuthTestUtils?: boolean;
  runtime: ServerRuntimeConfig;
  storage?: ServerStorage;
}

type ServerApiEnv = {
  Variables: ServerApiVariables;
};

type ServerApiLogLevel = "error" | "info" | "warn";

function getDashboardApiLogLevelForStatus(status: number): ServerApiLogLevel {
  if (status >= 500) {
    return "error";
  }

  if (status >= 400) {
    return "warn";
  }

  return "info";
}

const dashboardApiStructuredLogger = structuredLogger({
  createLogger: () => console,
  onError: (logger, error, c) => {
    logger.error(
      {
        err: error,
        event: "dashboard.request.failed",
        method: c.req.method,
        path: c.req.path,
        requestId: c.get("requestId"),
        scope: "dashboard",
        status: c.res.status,
      },
      "dashboard request failed"
    );
  },
  onRequest: (logger, c) => {
    logger.info(
      {
        event: "dashboard.request.started",
        method: c.req.method,
        path: c.req.path,
        requestId: c.get("requestId"),
        scope: "dashboard",
      },
      "dashboard request started"
    );
  },
  onResponse: (logger, c, elapsedMs) => {
    logger[getDashboardApiLogLevelForStatus(c.res.status)](
      {
        elapsedMs,
        event: "dashboard.request.completed",
        method: c.req.method,
        path: c.req.path,
        requestId: c.get("requestId"),
        scope: "dashboard",
        status: c.res.status,
      },
      "dashboard request completed"
    );
  },
});

/**
 * Shared OSS-safe control-plane routes.
 * The caller owns the public mount point (for example `/api`).
 */
export function createServerApi(input: CreateServerApiOptions) {
  const storage =
    input.storage ??
    createServerStorage(input.runtime, createMemoryApiRateLimitStorage(), {
      enableAuthTestUtils: input.enableAuthTestUtils,
    });

  return (
    new Hono<ServerApiEnv>()
      .onError(
        createProblemDetailsErrorHandler("packages/server/createServerApi")
      )
      .use("*", requestId())
      // Comment: apps/dashboard is a client app; its Hono API surface lives
      // here and is mounted by the self-host runtime under `/api`.
      .use("*", dashboardApiStructuredLogger)
      .use("*", serverRuntimeMiddleware(input.runtime))
      .use("*", serverStorageMiddleware(storage))
      // Rate limiting (applied first to reject requests early)
      .use("*", apiRateLimiter({ enabled: input.runtime.rateLimit.enabled }))
      // Session middleware for protected routes
      .use("/organizations", sessionMiddleware())
      .use("/organizations/*", sessionMiddleware())
      .use("/stats", sessionMiddleware())
      .use("/stats/*", sessionMiddleware())
      .use("/team", sessionMiddleware())
      .use("/team/*", sessionMiddleware())
      .use("/data-sources", sessionMiddleware())
      .use("/data-sources/*", sessionMiddleware())
      .use("/budget", sessionMiddleware())
      .use("/budget/*", sessionMiddleware())
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

export type ServerApiType = ReturnType<typeof createServerApi>;
