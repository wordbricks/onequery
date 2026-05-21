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
import { DataSourceQueryExecutionError } from "../../core/errors";
import { normalizeColumnRows, parseIntegerString } from "../../core/rows";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "../../core/timeout";
import type { QueryDeadline } from "../../core/timeout";
import type {
  AthenaConnectorQueryExecutionStats,
  DatabaseQueryExecution,
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
): Promise<Extract<ConnectorAthenaJobOutcome, { status: "success" }>> {
  const timeoutMs = input.timeoutMs ?? QUERY_TIMEOUT_MS;
  const organizationId = input.context.organizationId;

  if (!organizationId) {
    throw new DataSourceQueryExecutionError(
      "Organization ID is required for connector queries."
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
      throw new DataSourceQueryExecutionError(
        `Connector query failed (${outcome.value.error.code}): ${outcome.value.error.message}`,
        {
          retryable: outcome.value.error.code === "QUERY_TIMEOUT",
          timedOut: outcome.value.error.code === "QUERY_TIMEOUT",
        }
      );
    }

    return outcome.value;
  }

  if (outcome.error instanceof ConnectorJobTimeoutError) {
    throw new DataSourceQueryExecutionError(outcome.error.message, {
      retryable: true,
      timedOut: true,
    });
  }

  throw new DataSourceQueryExecutionError(outcome.error.message, {
    retryable: outcome.error.status >= 500,
    timedOut: false,
  });
}

export async function executeConnectorQuery(
  creds: ConnectorCredentials,
  query: string,
  input: {
    db?: QueryExecutionContext["db"];
    timeoutMs?: number;
    organizationId: string;
  }
): Promise<Record<string, unknown>[]> {
  const outcome = await executeConnectorAthenaJob(creds, query, {
    context: {
      db: input.db,
      organizationId: input.organizationId,
    },
    timeoutMs: input.timeoutMs,
  });
  return normalizeColumnRows(outcome.columns, outcome.rows);
}

export async function executeConnectorQueryWithStats(
  creds: ConnectorCredentials,
  query: string,
  input: {
    db?: QueryExecutionContext["db"];
    timeoutMs?: number;
    organizationId: string;
  }
): Promise<DatabaseQueryExecution> {
  const outcome = await executeConnectorAthenaJob(creds, query, {
    context: {
      db: input.db,
      organizationId: input.organizationId,
    },
    timeoutMs: input.timeoutMs,
  });
  return {
    rows: normalizeColumnRows(outcome.columns, outcome.rows),
    stats: buildAthenaConnectorStats({
      creds,
      outcome,
    }),
  };
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
    if (mode === "rows_with_stats") {
      const organizationId = requireOrganizationId(context, "queries");
      return executeConnectorQueryWithStats(credentials, sql, {
        db: context.db,
        organizationId,
        timeoutMs: deadline.timeoutMs,
      });
    }

    const organizationId = requireOrganizationId(context, "queries");
    return {
      rows: await executeConnectorQuery(credentials, sql, {
        db: context.db,
        organizationId,
        timeoutMs: deadline.timeoutMs,
      }),
    };
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
    execute: async () =>
      executeConnectorQuery(credentials, CONNECTION_TEST_QUERY, {
        db: context.db,
        organizationId: context.organizationId as string,
        timeoutMs: deadline.timeoutMs,
      }),
  });
}

function requireOrganizationId(
  context: QueryExecutionContext,
  subject: "queries" | "tests"
): string {
  if (!context.organizationId) {
    throw new DataSourceQueryExecutionError(
      `Organization ID is required for connector ${subject}.`
    );
  }

  return context.organizationId;
}
