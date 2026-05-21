export const CONNECTOR_BASE_URL_TOKEN = "__ONEQUERY_CONNECTOR_BASE_URL__";

export type DataSourceConnectionGuideProvider =
  | "amplitude"
  | "aws_athena_connector"
  | "bigquery"
  | "cloudflare_d1"
  | "cloudflare_workers_observability"
  | "ga"
  | "github"
  | "laminar"
  | "mixpanel"
  | "mongodb"
  | "mysql"
  | "postgres"
  | "posthog"
  | "sentry"
  | "snowflake"
  | "supabase";

export interface GuideStep {
  title: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
  code?: string;
  note?: string;
  imageSrc?: string;
  imageAlt?: string;
  reverse?: boolean;
}

export interface GuideLocaleContent {
  title: string;
  description: string;
  steps: readonly GuideStep[];
  closingTitle?: string;
  closingDescription?: string;
  closingNote?: string;
}

export interface GuideContent {
  providerLabel: string;
  ko?: GuideLocaleContent;
  en?: GuideLocaleContent;
}
