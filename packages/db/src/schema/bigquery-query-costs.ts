import {
  bigint,
  boolean,
  doublePrecision,
  index,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { pgTable } from "./table";
import { ulid } from "./ulid";

export const BIGQUERY_QUERY_COST_CURRENCIES = ["USD"] as const;
export type BigQueryQueryCostCurrency =
  (typeof BIGQUERY_QUERY_COST_CURRENCIES)[number];

export const BIGQUERY_QUERY_COST_PRICING_MODELS = [
  "on_demand",
  "unknown",
] as const;
export type BigQueryQueryCostPricingModel =
  (typeof BIGQUERY_QUERY_COST_PRICING_MODELS)[number];

export const bigqueryQueryCosts = pgTable(
  "bigquery_query_costs",
  {
    actualBytesBilled: bigint("actual_bytes_billed", {
      mode: "bigint",
    }),
    actualBytesProcessed: bigint("actual_bytes_processed", {
      mode: "bigint",
    }),
    actualCostUsd: doublePrecision("actual_cost_usd"),
    cacheHit: boolean("cache_hit"),
    connectionName: text("connection_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    currency: text("currency")
      .$type<BigQueryQueryCostCurrency>()
      .notNull()
      .default("USD"),
    estimatedBytesProcessed: bigint("estimated_bytes_processed", {
      mode: "bigint",
    }),
    estimatedCostUsd: doublePrecision("estimated_cost_usd"),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    id: text("id").primaryKey().$defaultFn(ulid),
    jobId: text("job_id"),
    location: text("location"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pricingModel: text("pricing_model")
      .$type<BigQueryQueryCostPricingModel>()
      .notNull()
      .default("unknown"),
    queryId: text("query_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
  },
  (table) => [
    index("idx_bigquery_query_costs_org").on(table.organizationId),
    index("idx_bigquery_query_costs_executed_at").on(table.executedAt),
  ]
);

export type BigQueryQueryCost = typeof bigqueryQueryCosts.$inferSelect;
export type NewBigQueryQueryCost = typeof bigqueryQueryCosts.$inferInsert;
