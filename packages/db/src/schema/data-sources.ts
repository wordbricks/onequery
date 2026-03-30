import { boolean, index, text, timestamp, unique } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const PROVIDER_TYPES = [
  "postgres",
  "supabase",
  "mysql",
  "mongodb",
  "bigquery",
  "laminar",
  "aws_athena_connector",
  "ga", // Google Analytics
  "amplitude",
  "mixpanel",
  "posthog",
  "sentry",
  "github",
  "linear",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** Provider types that can be queried for data analysis (not delivery channels) */
export const QUERYABLE_PROVIDER_TYPES = [
  "postgres",
  "supabase",
  "mysql",
  "mongodb",
  "bigquery",
  "laminar",
  "aws_athena_connector",
  "ga",
  "amplitude",
  "mixpanel",
  "posthog",
  "sentry",
  "github",
  "linear",
] as const satisfies readonly ProviderType[];

export type QueryableProviderType = (typeof QUERYABLE_PROVIDER_TYPES)[number];

export const TESTABLE_PROVIDER = {
  AMPLITUDE: "amplitude",
  MIXPANEL: "mixpanel",
  MONGODB: "mongodb",
  MYSQL: "mysql",
  POSTGRES: "postgres",
  SUPABASE: "supabase",
  POSTHOG: "posthog",
  SENTRY: "sentry",
} as const;

export type TestableProviderType =
  (typeof TESTABLE_PROVIDER)[keyof typeof TESTABLE_PROVIDER];

export const TESTABLE_PROVIDER_TYPES = [
  TESTABLE_PROVIDER.POSTGRES,
  TESTABLE_PROVIDER.SUPABASE,
  TESTABLE_PROVIDER.MYSQL,
  TESTABLE_PROVIDER.MONGODB,
  TESTABLE_PROVIDER.AMPLITUDE,
  TESTABLE_PROVIDER.MIXPANEL,
  TESTABLE_PROVIDER.POSTHOG,
  TESTABLE_PROVIDER.SENTRY,
] as const satisfies readonly TestableProviderType[];

export function isTestableProviderType(
  provider: ProviderType
): provider is TestableProviderType {
  return TESTABLE_PROVIDER_TYPES.some((value) => value === provider);
}

export const DATA_SOURCE_STATUS = ["active", "error", "disconnected"] as const;

export type DataSourceStatus = (typeof DATA_SOURCE_STATUS)[number];

export const dataSources = pgTable(
  "data_sources",
  {
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    credentialsIv: text("credentials_iv").notNull(),
    errorMessage: text("error_message"),
    id: text("id").primaryKey().$defaultFn(ulid),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().$type<ProviderType>(),
    providerAccountId: text("provider_account_id"),
    scope: text("scope"),
    status: text("status")
      .notNull()
      .$type<DataSourceStatus>()
      .default("active"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    useAsDataSource: boolean("use_as_data_source").notNull().default(true),
  },
  (table) => [
    unique("data_sources_organization_name_unique").on(
      table.organizationId,
      table.name
    ),
    index("idx_data_sources_organization").on(table.organizationId),
    index("idx_data_sources_provider").on(table.provider),
    index("idx_data_sources_provider_account").on(
      table.provider,
      table.providerAccountId
    ),
    index("idx_data_sources_status").on(table.status),
  ]
);

export type DataSource = typeof dataSources.$inferSelect;
export type NewDataSource = typeof dataSources.$inferInsert;
