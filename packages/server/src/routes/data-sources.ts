import { Hono } from "hono";

import type { ServerEnv } from "../env";
import type { SessionVariables } from "../middleware/session";
import { dataSourcesAmplitudeQueryRoute } from "./data-sources/amplitude-query";
import { dataSourcesCrudRoute } from "./data-sources/crud";
import { dataSourcesGaQueryRoute } from "./data-sources/ga-query";
import { dataSourcesGitHubQueryRoute } from "./data-sources/github-query";
import { dataSourcesGitHubRepositoriesRoute } from "./data-sources/github-repositories";
import { dataSourcesMixpanelQueryRoute } from "./data-sources/mixpanel-query";
import { dataSourcesMongoDbQueryRoute } from "./data-sources/mongodb-query";
import { dataSourcesPostHogQueryRoute } from "./data-sources/posthog-query";
import { dataSourcesSentryQueryRoute } from "./data-sources/sentry-query";
import { dataSourcesTestRoute } from "./data-sources/test";

/**
 * Data Sources API routes.
 *
 * Split into sub-routes for maintainability:
 * - crud.ts: List, get, create, update, delete operations
 * - amplitude-query.ts: Amplitude relay queries for sandbox SDK
 * - ga-query.ts: Google Analytics relay queries for sandbox SDK
 * - github-query.ts: GitHub relay queries for sandbox SDK
 * - mixpanel-query.ts: Mixpanel relay queries for sandbox SDK
 * - mongodb-query.ts: MongoDB relay queries for sandbox SDK
 * - posthog-query.ts: PostHog relay queries for sandbox SDK
 * - sentry-query.ts: Sentry relay queries for sandbox SDK
 * - test.ts: Test data source connection
 */
export const dataSourcesRoute = new Hono<{
  Bindings: ServerEnv;
  Variables: SessionVariables;
}>()
  .route("/", dataSourcesCrudRoute)
  .route("/", dataSourcesAmplitudeQueryRoute)
  .route("/", dataSourcesGaQueryRoute)
  .route("/", dataSourcesGitHubQueryRoute)
  .route("/", dataSourcesMixpanelQueryRoute)
  .route("/", dataSourcesMongoDbQueryRoute)
  .route("/", dataSourcesPostHogQueryRoute)
  .route("/", dataSourcesSentryQueryRoute)
  .route("/", dataSourcesGitHubRepositoriesRoute)
  .route("/", dataSourcesTestRoute);
