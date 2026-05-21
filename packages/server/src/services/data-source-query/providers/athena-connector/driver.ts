import type { ConnectorCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import {
  ConnectorJobTimeoutError,
  queueConnectorAthenaJob,
} from "../../../connectors/broker";
import type { ConnectorAthenaJobOutcome } from "../../../connectors/broker";
import {
  calculateAthenaUsd,
  resolveAthenaPricingModel,
} from "../../athena-pricing";
import {
  createFailedConnectionTest,
  runProviderConnectionTest,
} from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import {
  ProviderResponseFailure,
  ProviderTransportFailure,
  QueryInputFailure,
  QueryTimeoutFailure,
} from "../../core/errors";
import { normalizeColumnRows, parseIntegerString } from "../../core/rows";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "../../core/timeout";
import type { QueryDeadline } from "../../core/timeout";
import type {
  AthenaConnectorQueryExecutionStats,
  DatabaseQueryExecution,
  DatabaseQueryResult,
  QueryExecutionContext,
} from "../../core/types";
import { validateReadOnlySql } from "../../core/validation";

const CONNECTOR_RESULT_TIMEOUT_BUFFER_MS = 2000;
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

function buildAthenaConnectorStats(input: {
  creds: ConnectorCredentials;
  outcome: Extract<ConnectorAthenaJobOutcome, { status: "success" }>;
}): AthenaConnectorQueryExecutionStats {
  const billableBytes = parseIntegerString(
    input.outcome.stats?.dataScannedBytes
  );
  const pricingModel = resolveAthenaPricingModel(billableBytes);

  return {
    actualCostUsd: calculateAthenaUsd(billableBytes),
    athenaQueryExecutionId: input.outcome.stats?.queryExecutionId,
    billableBytes,
    connectorId: input.creds.connectorId,
    connectorJobId: input.outcome.jobId,
    currency: "USD",
    database: input.creds.database,
    executionTimeMs: input.outcome.stats?.executionTimeMs,
    pricingModel,
    provider: "aws_athena_connector",
    rowCount: input.outcome.stats?.rowCount,
    workgroup: input.creds.workgroup,
  };
}

async function executeConnectorAthenaJob(
  creds: ConnectorCredentials,
  query: string,
  input: {
    context: QueryExecutionContext;
    timeoutMs?: number;
  }
): Promise<
  DatabaseQueryResult<Extract<ConnectorAthenaJobOutcome, { status: "success" }>>
> {
  const timeoutMs = input.timeoutMs ?? QUERY_TIMEOUT_MS;
  const organizationId = input.context.organizationId;

  if (!organizationId) {
    return Result.err(
      new QueryInputFailure({
        message: "Organization ID is required for connector queries.",
        provider: "aws_athena_connector",
      })
    );
  }

  const outcome = await queueConnectorAthenaJob({
    ...(input.context.db ? { db: input.context.db } : {}),
    connectorId: creds.connectorId,
    database: creds.database,
    maxRows: creds.maxRows,
    organizationId,
    sql: query,
    timeoutMs: creds.timeoutMs ?? timeoutMs,
    waitTimeoutMs: timeoutMs + CONNECTOR_RESULT_TIMEOUT_BUFFER_MS,
    workgroup: creds.workgroup,
  });
  if (outcome.isOk()) {
    if (outcome.value.status === "error") {
      if (outcome.value.error.code === "QUERY_TIMEOUT") {
        return Result.err(
          new QueryTimeoutFailure({
            message: `Connector query failed (${outcome.value.error.code}): ${outcome.value.error.message}`,
            provider: "aws_athena_connector",
            retryable: true,
            timedOut: true,
          })
        );
      }

      return Result.err(
        new ProviderResponseFailure({
          message: `Connector query failed (${outcome.value.error.code}): ${outcome.value.error.message}`,
          provider: "aws_athena_connector",
          retryable: outcome.value.error.code === "QUERY_TIMEOUT",
          timedOut: outcome.value.error.code === "QUERY_TIMEOUT",
        })
      );
    }

    return Result.ok(outcome.value);
  }

  if (outcome.error instanceof ConnectorJobTimeoutError) {
    return Result.err(
      new QueryTimeoutFailure({
        cause: outcome.error,
        message: outcome.error.message,
        provider: "aws_athena_connector",
        retryable: true,
        timedOut: true,
      })
    );
  }

  return Result.err(
    new ProviderTransportFailure({
      cause: outcome.error,
      message: outcome.error.message,
      provider: "aws_athena_connector",
      retryable: outcome.error.status >= 500,
    })
  );
}

export async function executeConnectorQuery(
  creds: ConnectorCredentials,
  query: string,
  input: {
    db?: QueryExecutionContext["db"];
    timeoutMs?: number;
    organizationId: string;
  }
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  const outcome = await executeConnectorAthenaJob(creds, query, {
    context: {
      db: input.db,
      organizationId: input.organizationId,
    },
    timeoutMs: input.timeoutMs,
  });
  return outcome.map((value) => normalizeColumnRows(value.columns, value.rows));
}

export async function executeConnectorQueryWithStats(
  creds: ConnectorCredentials,
  query: string,
  input: {
    db?: QueryExecutionContext["db"];
    timeoutMs?: number;
    organizationId: string;
  }
): Promise<DatabaseQueryResult<DatabaseQueryExecution>> {
  const outcome = await executeConnectorAthenaJob(creds, query, {
    context: {
      db: input.db,
      organizationId: input.organizationId,
    },
    timeoutMs: input.timeoutMs,
  });
  return outcome.map((value) => ({
    rows: normalizeColumnRows(value.columns, value.rows),
    stats: buildAthenaConnectorStats({
      creds,
      outcome: value,
    }),
  }));
}

export const athenaConnectorQueryDriver = {
  provider: "aws_athena_connector",
  capabilities: {
    cancellation: "best_effort",
    connectionTest: true,
    dryRun: false,
    stats: true,
  },
  validateSql: async ({ sql }) =>
    validateReadOnlySql({
      provider: "aws_athena_connector",
      sql,
    }),
  execute: async ({ context, credentials, deadline, mode, sql }) => {
    if (!context.organizationId) {
      return Result.err(
        new QueryInputFailure({
          message: "Organization ID is required for connector queries.",
          provider: "aws_athena_connector",
        })
      );
    }

    if (mode === "rows_with_stats") {
      return executeConnectorQueryWithStats(credentials, sql, {
        db: context.db,
        organizationId: context.organizationId,
        timeoutMs: deadline.timeoutMs,
      });
    }

    return (
      await executeConnectorQuery(credentials, sql, {
        db: context.db,
        organizationId: context.organizationId,
        timeoutMs: deadline.timeoutMs,
      })
    ).map((rows) => ({ rows }));
  },
  testConnection: async ({ context, credentials, deadline }) =>
    runAthenaConnectorConnectionTest(credentials, context, deadline),
} satisfies ProviderQueryDriver<ConnectorCredentials>;

async function runAthenaConnectorConnectionTest(
  credentials: ConnectorCredentials,
  context: QueryExecutionContext,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  if (!context.organizationId) {
    return Result.err(
      createFailedConnectionTest({
        detail: "Organization ID is required for connector test.",
        latencyMs: 0,
      })
    );
  }

  return runProviderConnectionTest({
    deadline,
    execute: () =>
      executeConnectorQuery(credentials, CONNECTION_TEST_QUERY, {
        db: context.db,
        organizationId: context.organizationId as string,
        timeoutMs: deadline.timeoutMs,
      }),
  });
}
