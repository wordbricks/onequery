import { Hono } from "hono";

import type { BetterAuthSessionVariables } from "../middleware/better-auth-session";
import type { ServerRuntimeVariables } from "../runtime-context";
import { dataSourcesCrudRoute } from "./data-sources/crud";
import { dataSourcesGitHubRepositoriesRoute } from "./data-sources/github-repositories";
import { dataSourcesProvidersRoute } from "./data-sources/providers";
import { dataSourcesTestRoute } from "./data-sources/test";

/**
 * Data Sources API routes.
 *
 * Split into sub-routes for maintainability:
 * - crud.ts: List, get, create, update, delete operations
 * - github-repositories.ts: GitHub repository listing helpers
 * - test.ts: Test data source connection
 */
export const dataSourcesRoute = new Hono<{
  Variables: ServerRuntimeVariables & BetterAuthSessionVariables;
}>()
  .route("/providers", dataSourcesProvidersRoute)
  .route("/", dataSourcesCrudRoute)
  .route("/", dataSourcesGitHubRepositoriesRoute)
  .route("/", dataSourcesTestRoute);
