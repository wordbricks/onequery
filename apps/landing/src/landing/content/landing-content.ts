import {
  CLI_SOURCE_URL,
  DOWNLOAD_COMMAND,
  INSTALL_SCRIPT_URL,
  REPOSITORY_URL,
} from "../config/landing-config";
import type { TerminalLine } from "../terminal/terminal-types";

type FooterLink = {
  href: string;
  label: string;
  trackingName: string;
};

type NavigationItem = {
  href: string;
  label: string;
};

type ConnectorAvailability = "Dashboard + CLI" | "CLI";

type ConnectorCapability = "API" | "Query" | "Connector" | "Workflow";

type DataSourceConnector = {
  availability: ConnectorAvailability;
  capabilities: ReadonlyArray<ConnectorCapability>;
  category: string;
  description: string;
  key: string;
  label: string;
};

type RoadmapStatus = "shipped" | "next" | "later";

type RoadmapItem = {
  key: string;
  title: string;
};

type RoadmapLane = {
  eyebrow: string;
  items: ReadonlyArray<RoadmapItem>;
  status: RoadmapStatus;
  title: string;
};

const querySnippet = `onequery agent debug \\
  --grant prod-debug-readonly \\
  --sentry ISSUE-7421 \\
  --sources sentry,postgres,github,linear`;

export const FOOTER_LINKS = [
  {
    href: REPOSITORY_URL,
    label: "GitHub",
    trackingName: "footer_github",
  },
  {
    href: CLI_SOURCE_URL,
    label: "CLI source",
    trackingName: "footer_cli_source",
  },
  {
    href: INSTALL_SCRIPT_URL,
    label: "Install script",
    trackingName: "footer_install_script",
  },
] satisfies ReadonlyArray<FooterLink>;

export const HERO_SIGNALS = [
  "No prod keys",
  "No prod writes",
  "Full audit",
] as const;

export const INSTALL_STEPS = [
  "Start gateway.",
  "Apply grant.",
  "Connect sources.",
] as const;

export const NAVIGATION_ITEMS = [
  { href: "/#demo", label: "Demo" },
  { href: "/#install", label: "Install" },
  { href: "/connectors", label: "Connectors" },
  { href: "/blog", label: "Blog" },
] satisfies ReadonlyArray<NavigationItem>;

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

export const ROADMAP_LANES = [
  {
    eyebrow: "Shipped",
    status: "shipped",
    title: "In production today",
    items: [
      {
        key: "read-only-query-validation",
        title: "Read-only query validation",
      },
      {
        key: "audit-log-for-every-query",
        title: "Audit log for every query",
      },
      {
        key: "organization-membership",
        title: "Organization & membership",
      },
      {
        key: "agent-entrypoints",
        title: "Claude Code, OpenClaw, Hermes",
      },
    ],
  },
  {
    eyebrow: "Next up",
    status: "next",
    title: "Production guardrails",
    items: [
      {
        key: "agent-profiles",
        title: "Agent profiles",
      },
      {
        key: "policy-templates",
        title: "Policy templates",
      },
      {
        key: "custom-connectors",
        title: "Custom connectors",
      },
    ],
  },
  {
    eyebrow: "Planned",
    status: "later",
    title: "Security operations",
    items: [
      {
        key: "1password",
        title: "1Password",
      },
      {
        key: "sso-saml",
        title: "SSO & SAML",
      },
      {
        key: "approval-workflow",
        title: "Approvals",
      },
    ],
  },
] satisfies ReadonlyArray<RoadmapLane>;

export const QUERY_DETAILS_SNIPPET = `source     orders-postgres-db
policy     writes blocked
statement  single statement
duration   82 ms
rows       31 returned
budget     $59.20 remaining`;

export const QUICKSTART_TERMINAL_LINES = [
  { kind: "prompt", text: DOWNLOAD_COMMAND },
  { kind: "output", text: "installed onequery under ~/.onequery" },
  { kind: "prompt", text: "onequery gateway start" },
  { kind: "output", text: "gateway listening on http://localhost:5656" },
  { kind: "prompt", text: "onequery grant apply prod-debug-readonly.yaml" },
  { kind: "output", text: "grant ready | credentials hidden" },
] satisfies ReadonlyArray<TerminalLine>;

export const QUERY_TERMINAL_LINES = [
  ...querySnippet.split("\n").map(
    (line, index): TerminalLine => ({
      kind: index === 0 ? "prompt" : "continuation",
      text: line,
    })
  ),
  { kind: "output", text: "grant loaded | credentials hidden" },
  { kind: "output", text: "read sentry + postgres limit 100" },
  { kind: "output", text: "opened PR + Linear issue | audited" },
] satisfies ReadonlyArray<TerminalLine>;
