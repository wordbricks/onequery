import { Hono } from "hono";

import type { ServerEnv } from "./env";
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
import { serverStorageMiddleware } from "./storage";

export type { ServerEnv } from "./env";
export type { SessionVariables } from "./middleware/session";

type ServerApiEnv = {
  Bindings: ServerEnv;
  Variables: SessionVariables;
};

/**
 * Shared OSS-safe control-plane routes.
 * The caller owns the public mount point (for example `/api`).
 */
export const serverApiRoutes = new Hono<ServerApiEnv>()
  .onError(createProblemDetailsErrorHandler("packages/server/serverApiRoutes"))
  .use("*", serverStorageMiddleware())
  // Rate limiting (applied first to reject requests early)
  .use("*", apiRateLimiter())
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
  .route("/team", teamRoute);

const serverApiApp = new Hono<ServerApiEnv>().route("/api", serverApiRoutes);

export type ServerApiType = typeof serverApiApp;
