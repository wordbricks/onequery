import { amplitudeGuideContent } from "./amplitude";
import { awsAthenaConnectorGuideContent } from "./aws-athena-connector";
import { bigqueryGuideContent } from "./bigquery";
import { cloudflareD1GuideContent } from "./cloudflare-d1";
import { cloudflareR2SqlGuideContent } from "./cloudflare-r2-sql";
import { cloudflareWorkersObservabilityGuideContent } from "./cloudflare-workers-observability";
import { gaGuideContent } from "./ga";
import { githubGuideContent } from "./github";
import { googleSearchConsoleGuideContent } from "./google-search-console";
import { laminarGuideContent } from "./laminar";
import { linkedInAdsGuideContent } from "./linkedin-ads";
import { mixpanelGuideContent } from "./mixpanel";
import { mongodbGuideContent } from "./mongodb";
import { motherduckGuideContent } from "./motherduck";
import { mysqlGuideContent } from "./mysql";
import { postgresGuideContent } from "./postgres";
import { posthogGuideContent } from "./posthog";
import { sendGridGuideContent } from "./sendgrid";
import { sentryGuideContent } from "./sentry";
import { snowflakeGuideContent } from "./snowflake";
import { supabaseGuideContent } from "./supabase";
import { tiktokMarketingGuideContent } from "./tiktok-marketing";
import type { DataSourceConnectionGuideProvider, GuideContent } from "./types";
import { CONNECTOR_BASE_URL_TOKEN } from "./types";
import { vercelGuideContent } from "./vercel";

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
  cloudflare_r2_sql: cloudflareR2SqlGuideContent,
  cloudflare_workers_observability: cloudflareWorkersObservabilityGuideContent,
  ga: gaGuideContent,
  google_search_console: googleSearchConsoleGuideContent,
  github: githubGuideContent,
  laminar: laminarGuideContent,
  linkedin_ads: linkedInAdsGuideContent,
  mixpanel: mixpanelGuideContent,
  motherduck: motherduckGuideContent,
  mongodb: mongodbGuideContent,
  mysql: mysqlGuideContent,
  onepassword: { providerLabel: "1Password" },
  postgres: postgresGuideContent,
  posthog: posthogGuideContent,
  sendgrid: sendGridGuideContent,
  sentry: sentryGuideContent,
  snowflake: snowflakeGuideContent,
  supabase: supabaseGuideContent,
  tiktok_marketing: tiktokMarketingGuideContent,
  vercel: vercelGuideContent,
};
