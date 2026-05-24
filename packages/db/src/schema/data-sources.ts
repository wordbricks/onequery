import { index, text, timestamp, unique } from "drizzle-orm/pg-core";

import {
  ANALYSIS_SOURCE_PROVIDER_TYPES,
  SOURCE_PROVIDER_IDS,
  TESTABLE_PROVIDER_TYPES,
  isTestableProviderType,
} from "../source-providers";
import { organization } from "./auth";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const PROVIDER_TYPES = SOURCE_PROVIDER_IDS;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** Provider types that can be used as analysis sources (not delivery channels). */
export { ANALYSIS_SOURCE_PROVIDER_TYPES };

export type AnalysisSourceProviderType =
  (typeof ANALYSIS_SOURCE_PROVIDER_TYPES)[number];

export { TESTABLE_PROVIDER_TYPES, isTestableProviderType };
export type TestableProviderType = (typeof TESTABLE_PROVIDER_TYPES)[number];

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
