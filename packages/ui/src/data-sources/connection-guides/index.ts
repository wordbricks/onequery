import { amplitudeGuideContent } from "./amplitude";
import { awsAthenaConnectorGuideContent } from "./aws-athena-connector";
import { bigqueryGuideContent } from "./bigquery";
import { cloudflareD1GuideContent } from "./cloudflare-d1";
import { cloudflareWorkersObservabilityGuideContent } from "./cloudflare-workers-observability";
import { gaGuideContent } from "./ga";
import { githubGuideContent } from "./github";
import { laminarGuideContent } from "./laminar";
import { mixpanelGuideContent } from "./mixpanel";
import { mongodbGuideContent } from "./mongodb";
import { motherduckGuideContent } from "./motherduck";
import { mysqlGuideContent } from "./mysql";
import { postgresGuideContent } from "./postgres";
import { posthogGuideContent } from "./posthog";
import { sentryGuideContent } from "./sentry";
import { snowflakeGuideContent } from "./snowflake";
import { supabaseGuideContent } from "./supabase";
import type { DataSourceConnectionGuideProvider, GuideContent } from "./types";
import { CONNECTOR_BASE_URL_TOKEN } from "./types";

export { CONNECTOR_BASE_URL_TOKEN };
export type {
  DataSourceConnectionGuideProvider,
  GuideContent,
  GuideLocaleContent,
  GuideStep,
} from "./types";

export const GUIDE_CONTENT: Record<
  DataSourceConnectionGuideProvider,
  GuideContent
> = {
  amplitude: amplitudeGuideContent,
  aws_athena_connector: awsAthenaConnectorGuideContent,
  bigquery: bigqueryGuideContent,
  cloudflare_d1: cloudflareD1GuideContent,
  cloudflare_workers_observability: cloudflareWorkersObservabilityGuideContent,
  ga: gaGuideContent,
  github: githubGuideContent,
  laminar: laminarGuideContent,
  mixpanel: mixpanelGuideContent,
  motherduck: motherduckGuideContent,
  mongodb: mongodbGuideContent,
  mysql: mysqlGuideContent,
  postgres: postgresGuideContent,
  posthog: posthogGuideContent,
  sentry: sentryGuideContent,
  snowflake: snowflakeGuideContent,
  supabase: supabaseGuideContent,
};
