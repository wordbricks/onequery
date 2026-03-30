import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { connectors } from "./connectors";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const DATA_SOURCE_QUERY_COST_PROVIDERS = [
  "bigquery",
  "aws_athena_connector",
] as const;
export type DataSourceQueryCostProvider =
  (typeof DATA_SOURCE_QUERY_COST_PROVIDERS)[number];

export const DATA_SOURCE_QUERY_COST_CURRENCIES = ["USD"] as const;
export type DataSourceQueryCostCurrency =
  (typeof DATA_SOURCE_QUERY_COST_CURRENCIES)[number];

export const DATA_SOURCE_QUERY_COST_PRICING_MODELS = [
  "on_demand",
  "per_tb_scanned",
  "unknown",
] as const;
export type DataSourceQueryCostPricingModel =
  (typeof DATA_SOURCE_QUERY_COST_PRICING_MODELS)[number];

export const dataSourceQueryCosts = pgTable(
  "data_source_query_costs",
  {
    actualCostUsd: doublePrecision("actual_cost_usd"),
    actualProcessedBytes: bigint("actual_processed_bytes", {
      mode: "bigint",
    }),
    billableBytes: bigint("billable_bytes", {
      mode: "bigint",
    }),
    cacheHit: boolean("cache_hit"),
    connectionName: text("connection_name").notNull(),
    connectorId: text("connector_id").references(() => connectors.connectorId, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    currency: text("currency")
      .$type<DataSourceQueryCostCurrency>()
      .notNull()
      .default("USD"),
    database: text("database"),
    estimatedCostUsd: doublePrecision("estimated_cost_usd"),
    estimatedProcessedBytes: bigint("estimated_processed_bytes", {
      mode: "bigint",
    }),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    executionTimeMs: integer("execution_time_ms"),
    id: text("id").primaryKey().$defaultFn(ulid),
    jobId: text("job_id"),
    location: text("location"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pricingModel: text("pricing_model")
      .$type<DataSourceQueryCostPricingModel>()
      .notNull()
      .default("unknown"),
    provider: text("provider").$type<DataSourceQueryCostProvider>().notNull(),
    queryExecutionId: text("query_execution_id"),
    queryId: text("query_id").notNull(),
    rowCount: integer("row_count"),
    toolCallId: text("tool_call_id").notNull(),
    workgroup: text("workgroup"),
  },
  (table) => [
    index("idx_data_source_query_costs_org").on(table.organizationId),
    index("idx_data_source_query_costs_provider").on(table.provider),
    index("idx_data_source_query_costs_executed_at").on(table.executedAt),
  ]
);

export type DataSourceQueryCost = typeof dataSourceQueryCosts.$inferSelect;
export type NewDataSourceQueryCost = typeof dataSourceQueryCosts.$inferInsert;
