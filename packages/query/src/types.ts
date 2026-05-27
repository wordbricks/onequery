import type { Result as ResultType } from "better-result";

import type {
  BigQueryCredentials,
  ConnectorCredentials,
  DatabaseCredentials,
  QueryProviderId,
} from "./credentials";
import type { DataSourceQueryFailure } from "./errors";

declare const validatedSqlBrand: unique symbol;
declare const preparedReadOnlyQueryBrand: unique symbol;

export type ValidatedSql = string & {
  readonly [validatedSqlBrand]: "ValidatedSql";
};

export type PreparedReadOnlyQuery<
  Provider extends QueryProviderId = QueryProviderId,
> = {
  readonly normalizedSql: string;
  readonly provider: Provider;
  readonly sql: ValidatedSql;
  readonly [preparedReadOnlyQueryBrand]: "PreparedReadOnlyQuery";
};

export function createPreparedReadOnlyQuery<
  Provider extends QueryProviderId,
>(input: {
  normalizedSql: string;
  provider: Provider;
}): PreparedReadOnlyQuery<Provider> {
  return {
    normalizedSql: input.normalizedSql,
    provider: input.provider,
    sql: input.normalizedSql as ValidatedSql,
  } as PreparedReadOnlyQuery<Provider>;
}

export type BigQueryPricingModel = "on_demand" | "unknown";
export type AthenaPricingModel = "per_tb_scanned" | "unknown";

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

export type DatabaseQueryResult<T> = ResultType<T, DataSourceQueryFailure>;

export type QueryExecutionContext = {
  db?: unknown;
  organizationId?: string;
};

export type DatabaseQueryInputBase<
  Credentials extends DatabaseCredentials = DatabaseCredentials,
  Context extends QueryExecutionContext = QueryExecutionContext,
> = {
  credentials: Credentials;
  context?: Context;
  timeoutMs?: number | null;
};

export type RawDatabaseQueryInput<
  Credentials extends DatabaseCredentials = DatabaseCredentials,
  Context extends QueryExecutionContext = QueryExecutionContext,
> = DatabaseQueryInputBase<Credentials, Context> & {
  sql: string;
};

export type PreparedDatabaseQueryInput<
  Credentials extends DatabaseCredentials = DatabaseCredentials,
  Context extends QueryExecutionContext = QueryExecutionContext,
> = DatabaseQueryInputBase<Credentials, Context> & {
  query: PreparedReadOnlyQuery<Credentials["type"]>;
};

export type ValidatedDatabaseQueryInput<
  Credentials extends DatabaseCredentials = DatabaseCredentials,
  Context extends QueryExecutionContext = QueryExecutionContext,
> = DatabaseQueryInputBase<Credentials, Context> & {
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

export type BigQueryCredentialsWithProvider = BigQueryCredentials;
export type ConnectorCredentialsWithProvider = ConnectorCredentials;
