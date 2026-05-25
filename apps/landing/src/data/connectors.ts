export type ConnectorAvailability = "Dashboard + CLI" | "CLI";

export type ConnectorCapability = "API" | "Query" | "Connector" | "Workflow";

export type DataSourceConnector = {
  availability: ConnectorAvailability;
  capabilities: ReadonlyArray<ConnectorCapability>;
  category: string;
  description: string;
  key: string;
  label: string;
};

export const DATA_SOURCE_CONNECTORS = [
  {
    availability: "Dashboard + CLI",
    capabilities: ["Query"],
    category: "Databases",
    description: "Direct PostgreSQL connections with governed read access.",
    key: "postgres",
    label: "PostgreSQL",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["Query"],
    category: "Databases",
    description: "Supabase over the Postgres wire protocol.",
    key: "supabase",
    label: "Supabase",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["Query"],
    category: "Databases",
    description: "Direct MySQL connections with SQL guardrails.",
    key: "mysql",
    label: "MySQL",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Databases",
    description: "MongoDB connection-string access for document data.",
    key: "mongodb",
    label: "MongoDB",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["Query"],
    category: "Warehouses",
    // Comment: the server has a BigQuery source-api adapter, but the public
    // provider catalog currently advertises BigQuery as query-only. Keep the
    // landing page aligned with the public catalog until those flags converge.
    description:
      "BigQuery datasets through service-account or OAuth credentials.",
    key: "bigquery",
    label: "BigQuery",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["Query"],
    category: "Warehouses",
    description:
      "Snowflake warehouses through scoped read-only roles and login credentials.",
    key: "snowflake",
    label: "Snowflake",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["Query"],
    category: "Warehouses",
    description:
      "Cloudflare D1 databases through scoped Cloudflare API tokens.",
    key: "cloudflare_d1",
    label: "Cloudflare D1",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["Connector", "Query"],
    category: "Warehouses",
    description:
      "Registered connector path for AWS Athena workgroups and databases.",
    key: "aws_athena_connector",
    label: "AWS Athena Connector",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["Query"],
    category: "Observability",
    description:
      "Laminar traces and evaluations through an API-key connection.",
    key: "laminar",
    label: "Laminar",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Observability",
    description: "Sentry issues and project context through a personal token.",
    key: "sentry",
    label: "Sentry",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Observability",
    description:
      "Cloudflare Workers logs and telemetry for production services.",
    key: "cloudflare_workers_observability",
    label: "Cloudflare Workers Observability",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Product analytics",
    description:
      "Google Analytics properties through OAuth or service accounts.",
    key: "ga",
    label: "Google Analytics",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Product analytics",
    description: "Amplitude projects through project API and secret keys.",
    key: "amplitude",
    label: "Amplitude",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Product analytics",
    description: "Mixpanel project access through service-account credentials.",
    key: "mixpanel",
    label: "Mixpanel",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Product analytics",
    description: "PostHog project access through personal API keys.",
    key: "posthog",
    label: "PostHog",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Marketing",
    description: "LinkedIn ad accounts and campaigns through Marketing API.",
    key: "linkedin_ads",
    label: "LinkedIn Ads",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Marketing",
    description: "TikTok advertiser account and campaign data.",
    key: "tiktok_marketing",
    label: "TikTok Marketing",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Marketing",
    description: "SendGrid account and marketing email data through v3 API.",
    key: "sendgrid",
    label: "SendGrid",
  },
  {
    availability: "Dashboard + CLI",
    capabilities: ["API"],
    category: "Developer workflow",
    description: "GitHub repository context through fine-grained tokens.",
    key: "github",
    label: "GitHub",
  },
  {
    availability: "CLI",
    capabilities: ["Workflow"],
    category: "Developer workflow",
    description: "Linear workspace context through API keys or OAuth tokens.",
    key: "linear",
    label: "Linear",
  },
] satisfies ReadonlyArray<DataSourceConnector>;
