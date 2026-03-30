import {
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import type { ProviderType } from "./data-sources";
import { dataSources } from "./data-sources";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export type TableUsageColumn = {
  name: string;
  type: string;
  isNullable: boolean;
};

export type TableUsageTable = {
  schemaName: string;
  tableName: string;
  columns: TableUsageColumn[];
};

export type TableUsageTableMemo = {
  purpose: string;
  exactGrainAndPrimaryKey: string;
  downstreamUsagePattern: string;
  alternativeTable: string;
  freshness: string;
  deprecationStatus: string;
  unusedSince: string;
  notes: string;
};

export type TableUsageColumnMemo = {
  usage: string;
  deprecationStatus: string;
  unusedSince: string;
  notes: string;
};

export type TableUsageLineageEntry = {
  upstream: string[];
  downstream: string[];
};

export type TableUsageLineage = Record<string, TableUsageLineageEntry>;

export const dataSourceTableUsage = pgTable(
  "data_source_table_usage",
  {
    columnMemos: jsonb("column_memos")
      .$type<Record<string, Record<string, TableUsageColumnMemo>>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    formatted: text("formatted").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    memoUpdatedAt: timestamp("memo_updated_at", { withTimezone: true }),
    memoUpdatedBy: text("memo_updated_by").references(() => user.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().$type<ProviderType>(),
    schemaHash: text("schema_hash"),
    tableLineage: jsonb("table_lineage")
      .$type<TableUsageLineage>()
      .notNull()
      .default({}),
    tableMemos: jsonb("table_memos")
      .$type<Record<string, TableUsageTableMemo>>()
      .notNull()
      .default({}),
    tables: jsonb("tables").$type<TableUsageTable[]>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_data_source_table_usage_source").on(table.dataSourceId),
    index("idx_data_source_table_usage_org").on(table.organizationId),
    index("idx_data_source_table_usage_provider").on(table.provider),
    index("idx_data_source_table_usage_generated_at").on(table.generatedAt),
  ]
);

export type DataSourceTableUsage = typeof dataSourceTableUsage.$inferSelect;
export type NewDataSourceTableUsage = typeof dataSourceTableUsage.$inferInsert;
