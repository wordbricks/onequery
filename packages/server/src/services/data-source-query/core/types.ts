import type {
  BigQueryCredentials,
  ConnectorCredentials,
  Database,
  DatabaseCredentials,
} from "@onequery/db/server";

import type { AthenaPricingModel } from "../athena-pricing";
import type { BigQueryPricingModel } from "../bigquery-pricing";

export type ValidatedSql = string & { readonly __validatedSql: unique symbol };

export type BigQueryQueryExecutionStats = {
  provider: "bigquery";
  estimatedProcessedBytes: bigint | null;
  actualProcessedBytes: bigint | null;
  billableBytes: bigint | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  currency: "USD";
  pricingModel: BigQueryPricingModel;
  jobId?: string;
  location?: string;
  cacheHit?: boolean;
};

export type AthenaConnectorQueryExecutionStats = {
  provider: "aws_athena_connector";
  billableBytes: bigint | null;
  actualCostUsd: number | null;
  currency: "USD";
  pricingModel: AthenaPricingModel;
  connectorId: string;
  connectorJobId: string;
  athenaQueryExecutionId?: string;
  database: string;
  workgroup?: string;
  executionTimeMs?: number;
  rowCount?: number;
};

export type DatabaseQueryExecutionStats =
  | BigQueryQueryExecutionStats
  | AthenaConnectorQueryExecutionStats;

export type DatabaseQueryExecution = {
  rows: Record<string, unknown>[];
  stats?: DatabaseQueryExecutionStats;
};

export type DatabaseQueryInputBase = {
  credentials: DatabaseCredentials;
  timeoutMs?: number | null;
  organizationId?: string;
  db?: Database;
};

export type RawDatabaseQueryInput = DatabaseQueryInputBase & {
  sql: string;
};

export type ValidatedDatabaseQueryInput = DatabaseQueryInputBase & {
  normalizedSql: string;
};

export type BigQueryQueryOptions = {
  timeoutMs?: number | null;
  location?: string;
};

export type BigQueryRestQuery = {
  query: string;
  timeoutMs: number;
  location?: string;
};

export type QueryExecutionMode = "rows" | "rows_with_stats";

export type QueryExecutionContext = {
  db?: Database;
  organizationId?: string;
};

export type BigQueryCredentialsWithProvider = BigQueryCredentials;
export type ConnectorCredentialsWithProvider = ConnectorCredentials;
