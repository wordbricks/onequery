import type { BigQueryCredentials } from "@onequery/query";
import {
  createFailedConnectionTest,
  createUnsupportedConnectionTest,
  runProviderConnectionTest,
} from "@onequery/query/connection-test";
import type { ProviderQueryDriver } from "@onequery/query/driver";
import type { QueryErrorClassification } from "@onequery/query/errors";
import {
  ProviderResponseFailure,
  QueryInputFailure,
  readHttpStatusCode,
  toErrorMessage,
  toQueryFailure,
} from "@onequery/query/errors";
import { normalizeRecordRows, parseIntegerString } from "@onequery/query/rows";
import { hasControlCharacters } from "@onequery/query/security";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "@onequery/query/timeout";
import type { QueryDeadline } from "@onequery/query/timeout";
import type {
  BigQueryQueryOptions,
  BigQueryRestQuery,
  DatabaseQueryExecution,
  DatabaseQueryResult,
} from "@onequery/query/types";
import { Result } from "better-result";

import { createBigQueryClient } from "../../bigquery-client";
import {
  calculateBigQueryOnDemandUsd,
  resolveBigQueryPricingModel,
} from "../../bigquery-pricing";

const TRANSIENT_BIGQUERY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

function buildBigQueryQueryOptions(input: {
  query: string;
  timeoutMs: number;
  location?: string;
}): DatabaseQueryResult<BigQueryRestQuery> {
  const base: BigQueryRestQuery = {
    query: input.query,
    timeoutMs: input.timeoutMs,
  };

  const location = normalizeBigQueryLocation(input.location);
  if (location.isErr()) {
    return location;
  }

  return Result.ok(
    location.value
      ? {
          ...base,
          location: location.value,
        }
      : base
  );
}

function normalizeBigQueryLocation(
  location: string | undefined
): DatabaseQueryResult<string | undefined> {
  if (location === undefined) {
    return Result.ok(undefined);
  }

  const normalized = location.trim();
  if (normalized.length === 0) {
    return Result.ok(undefined);
  }
  if (
    normalized.length > 128 ||
    hasControlCharacters(normalized) ||
    !/^[A-Za-z0-9_-]+$/u.test(normalized)
  ) {
    return Result.err(
      new QueryInputFailure({
        message: "BigQuery location is invalid",
        provider: "bigquery",
      })
    );
  }
  return Result.ok(normalized);
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
  let rows: Record<string, unknown>[];
  try {
    rows = normalizeRecordRows("BigQuery", execution.rows);
  } catch (cause) {
    throw new ProviderResponseFailure({
      cause,
      message: toErrorMessage(cause),
      provider: "bigquery",
      retryable: false,
      timedOut: false,
    });
  }
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
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  const execution = await executeBigQueryQueryInternal(creds, query, {
    includeStats: false,
    options,
  });
  return execution.map((result) => result.rows);
}

export async function executeBigQueryQueryWithStats(
  creds: BigQueryCredentials,
  query: string,
  options?: BigQueryQueryOptions
): Promise<DatabaseQueryResult<DatabaseQueryExecution>> {
  return executeBigQueryQueryInternal(creds, query, {
    includeStats: true,
    options,
  });
}

async function executeBigQueryQueryInternal(
  creds: BigQueryCredentials,
  query: string,
  input: {
    includeStats: boolean;
    options?: BigQueryQueryOptions;
  }
): Promise<DatabaseQueryResult<DatabaseQueryExecution>> {
  const deadline = createQueryDeadline(input.options?.timeoutMs);

  return Result.gen(async function* executeBigQueryQueryFlow() {
    const bigquery = yield* Result.await(
      Result.tryPromise({
        try: () => createBigQueryClient(creds),
        catch: (error) =>
          toQueryFailure({
            classifier: classifyBigQueryError,
            error,
            provider: "bigquery",
          }),
      })
    );
    const queryOptions = yield* buildBigQueryQueryOptions({
      location: input.options?.location,
      query,
      timeoutMs: deadline.timeoutMs,
    });
    const execution = yield* Result.await(
      Result.tryPromise({
        try: () => executeBigQueryJob(bigquery, queryOptions),
        catch: (error) =>
          toQueryFailure({
            classifier: classifyBigQueryError,
            error,
            provider: "bigquery",
          }),
      })
    );

    if (
      !input.includeStats ||
      !execution.stats ||
      execution.stats.provider !== "bigquery"
    ) {
      return Result.ok(execution);
    }

    const estimatedProcessedBytes = yield* Result.await(
      Result.tryPromise({
        try: () => runBigQueryDryRun(bigquery, queryOptions),
        catch: (error) =>
          toQueryFailure({
            classifier: classifyBigQueryError,
            error,
            provider: "bigquery",
          }),
      })
    );
    const pricingModel = execution.stats.pricingModel;
    return Result.ok({
      rows: execution.rows,
      stats: {
        ...execution.stats,
        estimatedCostUsd:
          pricingModel === "on_demand"
            ? calculateBigQueryOnDemandUsd(estimatedProcessedBytes)
            : null,
        estimatedProcessedBytes,
      },
    });
  });
}

export const bigQueryQueryDriver = {
  provider: "bigquery",
  capabilities: {
    cancellation: "best_effort",
    connectionTest: true,
    dryRun: true,
    stats: true,
  },
  execute: async ({ credentials, deadline, mode, sql }) => {
    if (mode === "rows_with_stats") {
      return executeBigQueryQueryWithStats(credentials, sql, {
        timeoutMs: deadline.timeoutMs,
      });
    }

    return (
      await executeBigQueryQuery(credentials, sql, {
        timeoutMs: deadline.timeoutMs,
      })
    ).map((rows) => ({ rows }));
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
    execute: () =>
      executeBigQueryQuery(credentials, CONNECTION_TEST_QUERY, {
        timeoutMs: deadline.timeoutMs,
      }),
    mapError: (error, latencyMs) => {
      const statusCode =
        readHttpStatusCode(error) ?? readHttpStatusCode(error.cause);
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
