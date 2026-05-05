import { ProviderIcons } from "@/components/provider-icons";

const CONNECTABLE_DATA_SOURCE_METADATA = {
  amplitude: {
    icon: ProviderIcons.amplitude,
    label: "Amplitude",
    testable: true,
  },
  aws_athena_connector: {
    icon: ProviderIcons.aws_athena_connector,
    label: "AWS Athena Connector",
    testable: true,
  },
  bigquery: {
    icon: ProviderIcons.bigquery,
    label: "BigQuery",
    testable: false,
  },
  cloudflare_workers_observability: {
    icon: ProviderIcons.cloudflare_workers_observability,
    label: "Cloudflare Workers Observability",
    testable: false,
  },
  ga: {
    icon: ProviderIcons.ga,
    label: "Google Analytics",
    testable: true,
  },
  github: {
    icon: ProviderIcons.github,
    label: "GitHub",
    testable: false,
  },
  laminar: {
    icon: ProviderIcons.laminar,
    label: "Laminar",
    testable: false,
  },
  mixpanel: {
    icon: ProviderIcons.mixpanel,
    label: "Mixpanel",
    testable: true,
  },
  mongodb: {
    icon: ProviderIcons.mongodb,
    label: "MongoDB",
    testable: true,
  },
  mysql: {
    icon: ProviderIcons.mysql,
    label: "MySQL",
    testable: true,
  },
  postgres: {
    icon: ProviderIcons.postgres,
    label: "PostgreSQL",
    testable: true,
  },
  posthog: {
    icon: ProviderIcons.posthog,
    label: "PostHog",
    testable: true,
  },
  sentry: {
    icon: ProviderIcons.sentry,
    label: "Sentry",
    testable: true,
  },
  supabase: {
    icon: ProviderIcons.supabase,
    label: "Supabase",
    testable: true,
  },
} as const;

export const CONNECTABLE_DATA_SOURCE_OPTIONS = [
  {
    value: "postgres",
    ...CONNECTABLE_DATA_SOURCE_METADATA.postgres,
  },
  {
    value: "supabase",
    ...CONNECTABLE_DATA_SOURCE_METADATA.supabase,
  },
  {
    value: "mysql",
    ...CONNECTABLE_DATA_SOURCE_METADATA.mysql,
  },
  {
    value: "mongodb",
    ...CONNECTABLE_DATA_SOURCE_METADATA.mongodb,
  },
  {
    value: "ga",
    ...CONNECTABLE_DATA_SOURCE_METADATA.ga,
  },
  {
    value: "bigquery",
    ...CONNECTABLE_DATA_SOURCE_METADATA.bigquery,
  },
  {
    value: "cloudflare_workers_observability",
    ...CONNECTABLE_DATA_SOURCE_METADATA.cloudflare_workers_observability,
  },
  {
    value: "laminar",
    ...CONNECTABLE_DATA_SOURCE_METADATA.laminar,
  },
  {
    value: "aws_athena_connector",
    ...CONNECTABLE_DATA_SOURCE_METADATA.aws_athena_connector,
  },
  {
    value: "amplitude",
    ...CONNECTABLE_DATA_SOURCE_METADATA.amplitude,
  },
  {
    value: "mixpanel",
    ...CONNECTABLE_DATA_SOURCE_METADATA.mixpanel,
  },
  {
    value: "posthog",
    ...CONNECTABLE_DATA_SOURCE_METADATA.posthog,
  },
  {
    value: "sentry",
    ...CONNECTABLE_DATA_SOURCE_METADATA.sentry,
  },
  {
    value: "github",
    ...CONNECTABLE_DATA_SOURCE_METADATA.github,
  },
] as const;

export type ProviderType =
  (typeof CONNECTABLE_DATA_SOURCE_OPTIONS)[number]["value"];

const CONNECTABLE_PROVIDER_VALUES = new Set<string>(
  CONNECTABLE_DATA_SOURCE_OPTIONS.map((provider) => provider.value)
);
const TESTABLE_PROVIDER_VALUES = new Set<string>(
  CONNECTABLE_DATA_SOURCE_OPTIONS.flatMap((provider) =>
    provider.testable ? [provider.value] : []
  )
);
const PROVIDER_LABELS: Record<string, string> = {
  linear: "Linear",
  ...Object.fromEntries(
    CONNECTABLE_DATA_SOURCE_OPTIONS.map((provider) => [
      provider.value,
      provider.label,
    ])
  ),
};

export const DEFAULT_CONNECTABLE_PROVIDER =
  CONNECTABLE_DATA_SOURCE_OPTIONS[0].value;
export const CONNECTABLE_DATA_SOURCE_PROVIDERS =
  CONNECTABLE_DATA_SOURCE_OPTIONS.map(
    (provider) => provider.value
  ) as ProviderType[];

export function isProviderType(value: string): value is ProviderType {
  return CONNECTABLE_PROVIDER_VALUES.has(value);
}

export function isTestableDataSourceProvider(provider: string): boolean {
  return TESTABLE_PROVIDER_VALUES.has(provider);
}

export function getDataSourceProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
