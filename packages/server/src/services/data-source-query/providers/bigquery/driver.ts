import type { BigQueryCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { createBigQueryClient } from "../../bigquery-client";
import {
  calculateBigQueryOnDemandUsd,
  resolveBigQueryPricingModel,
} from "../../bigquery-pricing";
import {
  createFailedConnectionTest,
  createUnsupportedConnectionTest,
  runProviderConnectionTest,
} from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import type { QueryErrorClassification } from "../../core/errors";
import {
  DataSourceQueryExecutionError,
  readHttpStatusCode,
  toErrorMessage,
} from "../../core/errors";
import { normalizeRecordRows, parseIntegerString } from "../../core/rows";
import { hasControlCharacters } from "../../core/security";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "../../core/timeout";
import type { QueryDeadline } from "../../core/timeout";
import type {
  BigQueryQueryOptions,
  BigQueryRestQuery,
  DatabaseQueryExecution,
} from "../../core/types";
import { validateReadOnlySql } from "../../core/validation";

const TRANSIENT_BIGQUERY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

function buildBigQueryQueryOptions(input: {
  query: string;
  timeoutMs: number;
  location?: string;
}): BigQueryRestQuery {
  const base: BigQueryRestQuery = {
    query: input.query,
    timeoutMs: input.timeoutMs,
  };

  const location = normalizeBigQueryLocation(input.location);
  if (!location) {
    return base;
  }

  return {
    ...base,
    location,
  };
}

function normalizeBigQueryLocation(
  location: string | undefined
): string | undefined {
  if (location === undefined) {
    return undefined;
  }

  const normalized = location.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  if (
    normalized.length > 128 ||
    hasControlCharacters(normalized) ||
    !/^[A-Za-z0-9_-]+$/u.test(normalized)
  ) {
    throw new DataSourceQueryExecutionError("BigQuery location is invalid");
  }
  return normalized;
}

async function runBigQueryDryRun(
  bigquery: Awaited<ReturnType<typeof createBigQueryClient>>,
  options: BigQueryRestQuery
): Promise<bigint | null> {
  return bigquery
    .runDryRun(options)
    .then((totalBytesProcessed) => parseIntegerString(totalBytesProcessed))
    .catch((error: unknown) => {
      console.warn("[query-database] BigQuery dry run failed", {
        error: toErrorMessage(error),
      });
      return null;
    });
}

async function executeBigQueryJob(
  bigquery: Awaited<ReturnType<typeof createBigQueryClient>>,
  queryOptions: BigQueryRestQuery
): Promise<DatabaseQueryExecution> {
  const execution = await bigquery.runQuery(queryOptions);
  const rows = normalizeRecordRows("BigQuery", execution.rows);
  const actualProcessedBytes = parseIntegerString(
    execution.totalBytesProcessed
  );
  const billableBytes = parseIntegerString(execution.totalBytesBilled);
  const pricingModel = resolveBigQueryPricingModel(billableBytes);

  return {
    rows,
    stats: {
      actualCostUsd:
        pricingModel === "on_demand"
          ? calculateBigQueryOnDemandUsd(billableBytes)
          : null,
      actualProcessedBytes,
      billableBytes,
      cacheHit: execution.cacheHit,
      currency: "USD",
      estimatedCostUsd: null,
      estimatedProcessedBytes: null,
      jobId: execution.jobId,
      location: execution.location ?? queryOptions.location,
      pricingModel,
      provider: "bigquery",
    },
  };
}

export async function executeBigQueryQuery(
  creds: BigQueryCredentials,
  query: string,
  options?: BigQueryQueryOptions
): Promise<Record<string, unknown>[]> {
  const deadline = createQueryDeadline(options?.timeoutMs);
  const bigquery = await createBigQueryClient(creds);
  const queryOptions = buildBigQueryQueryOptions({
    location: options?.location,
    query,
    timeoutMs: deadline.timeoutMs,
  });
  const execution = await executeBigQueryJob(bigquery, queryOptions);
  return execution.rows;
}

export async function executeBigQueryQueryWithStats(
  creds: BigQueryCredentials,
  query: string,
  options?: BigQueryQueryOptions
): Promise<DatabaseQueryExecution> {
  const deadline = createQueryDeadline(options?.timeoutMs);
  const bigquery = await createBigQueryClient(creds);
  const queryOptions = buildBigQueryQueryOptions({
    location: options?.location,
    query,
    timeoutMs: deadline.timeoutMs,
  });
  const estimatedProcessedBytes = await runBigQueryDryRun(
    bigquery,
    queryOptions
  );
  const execution = await executeBigQueryJob(bigquery, queryOptions);
  if (!execution.stats || execution.stats.provider !== "bigquery") {
    return execution;
  }
  const pricingModel = execution.stats.pricingModel;
  return {
    rows: execution.rows,
    stats: {
      ...execution.stats,
      estimatedCostUsd:
        pricingModel === "on_demand"
          ? calculateBigQueryOnDemandUsd(estimatedProcessedBytes)
          : null,
      estimatedProcessedBytes,
    },
  };
}

export const bigQueryQueryDriver = {
  provider: "bigquery",
  capabilities: {
    cancellation: "best_effort",
    connectionTest: true,
    dryRun: true,
    stats: true,
  },
  validateSql: async ({ sql }) =>
    validateReadOnlySql({
      provider: "bigquery",
      sql,
    }),
  execute: async ({ credentials, deadline, mode, sql }) => {
    if (mode === "rows_with_stats") {
      return executeBigQueryQueryWithStats(credentials, sql, {
        timeoutMs: deadline.timeoutMs,
      });
    }

    return {
      rows: await executeBigQueryQuery(credentials, sql, {
        timeoutMs: deadline.timeoutMs,
      }),
    };
  },
  classifyError: classifyBigQueryError,
  testConnection: async ({ credentials, deadline }) =>
    runBigQueryConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<BigQueryCredentials>;

async function runBigQueryConnectionTest(
  credentials: BigQueryCredentials,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  if (credentials.authType === "oauth") {
    return Result.err(createUnsupportedConnectionTest("oauth"));
  }

  return runProviderConnectionTest({
    deadline,
    execute: async () => {
      await executeBigQueryQuery(credentials, CONNECTION_TEST_QUERY, {
        timeoutMs: deadline.timeoutMs,
      });
    },
    mapError: (error, latencyMs) => {
      const statusCode = readHttpStatusCode(error);
      if (statusCode === 401) {
        return createFailedConnectionTest({
          detail: "Invalid or expired BigQuery credentials",
          latencyMs,
          message: "Authentication failed",
        });
      }
      if (statusCode === 403) {
        return createFailedConnectionTest({
          detail: "BigQuery credentials do not have access to this project",
          latencyMs,
          message: "Access denied",
        });
      }

      return null;
    },
  });
}

function classifyBigQueryError(
  error: unknown
): QueryErrorClassification | null {
  const statusCode = readHttpStatusCode(error);
  if (statusCode === null) {
    return null;
  }

  return {
    retryable: TRANSIENT_BIGQUERY_STATUS_CODES.has(statusCode),
  };
}
