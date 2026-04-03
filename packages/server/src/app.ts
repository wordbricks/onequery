import { Hono } from "hono";

import { createMemoryApiRateLimitStorage } from "./lib/rate-limit-storage";
import { apiRateLimiter } from "./middleware/rate-limit";
import { sessionMiddleware } from "./middleware/session";
import type { SessionVariables } from "./middleware/session";
import { createProblemDetailsErrorHandler } from "./observability/error-reporting";
import { authRoute } from "./routes/auth";
import { bootstrapRoute } from "./routes/bootstrap";
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

type ServerApiVariables = ServerRuntimeVariables & SessionVariables;

export interface CreateServerApiOptions {
  enableAuthTestUtils?: boolean;
  runtime: ServerRuntimeConfig;
  storage?: ServerStorage;
}

type ServerApiEnv = {
  Variables: ServerApiVariables;
};

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
      .route("/", healthRoute)
      .route("/bootstrap", bootstrapRoute)
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
