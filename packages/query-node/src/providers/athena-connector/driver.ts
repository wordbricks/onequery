import type { ConnectorCredentials } from "@onequery/query";
import {
  createFailedConnectionTest,
  runProviderConnectionTest,
} from "@onequery/query/connection-test";
import type { DataSourceTestOutcome } from "@onequery/query/connection-test";
import type { ProviderQueryDriver } from "@onequery/query/driver";
import {
  ProviderResponseFailure,
  ProviderTransportFailure,
  QueryInputFailure,
  QueryTimeoutFailure,
} from "@onequery/query/errors";
import { normalizeColumnRows, parseIntegerString } from "@onequery/query/rows";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "@onequery/query/timeout";
import type { QueryDeadline } from "@onequery/query/timeout";
import type {
  AthenaConnectorQueryExecutionStats,
  DatabaseQueryExecution,
  DatabaseQueryResult,
  QueryExecutionContext,
} from "@onequery/query/types";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import {
  calculateAthenaUsd,
  resolveAthenaPricingModel,
} from "../../athena-pricing";

const CONNECTOR_RESULT_TIMEOUT_BUFFER_MS = 2000;
const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

export type ConnectorAthenaJobColumn = {
  name: string;
  type: string;
};

export type ConnectorAthenaJobOutcome =
  | {
      jobId: string;
      status: "success";
      columns: ConnectorAthenaJobColumn[];
      rows: string[][];
      stats?: {
        executionTimeMs?: number;
        rowCount?: number;
        dataScannedBytes?: string;
        queryExecutionId?: string;
      };
    }
  | {
      jobId: string;
      status: "error";
      error: {
        code: string;
        message: string;
      };
    };

export type ConnectorAthenaJobQueueFailure = {
  cause?: unknown;
  message: string;
  status: number;
  timedOut?: boolean;
};

export type ConnectorAthenaJobQueueInput = {
  context: QueryExecutionContext;
  connectorId: string;
  database: string;
  maxRows?: number;
  organizationId: string;
  sql: string;
  timeoutMs?: number;
  waitTimeoutMs: number;
  workgroup?: string;
};

export type ConnectorAthenaJobQueue = (
  input: ConnectorAthenaJobQueueInput
) => Promise<
  ResultType<ConnectorAthenaJobOutcome, ConnectorAthenaJobQueueFailure>
>;

export type AthenaConnectorQueryDriverDependencies = {
  queueJob: ConnectorAthenaJobQueue;
};

export type ConnectorAthenaJobBrokerFailure = {
  message: string;
  status: number;
};

export type ConnectorAthenaJobBrokerInput<Database = unknown> = Omit<
  ConnectorAthenaJobQueueInput,
  "context"
> & {
  db?: Database;
};

export type ConnectorAthenaJobBroker<
  Database = unknown,
  Failure extends ConnectorAthenaJobBrokerFailure =
    ConnectorAthenaJobBrokerFailure,
> = (
  input: ConnectorAthenaJobBrokerInput<Database>
) => Promise<ResultType<ConnectorAthenaJobOutcome, Failure>>;

export function createConnectorAthenaJobQueueAdapter<
  Database = unknown,
  Failure extends ConnectorAthenaJobBrokerFailure =
    ConnectorAthenaJobBrokerFailure,
>(input: {
  queueJob: ConnectorAthenaJobBroker<Database, Failure>;
  isTimedOut?: (failure: Failure) => boolean;
}): ConnectorAthenaJobQueue {
  return async (queueInput) => {
    const outcome = await input.queueJob({
      ...(queueInput.context.db === undefined
        ? {}
        : { db: queueInput.context.db as Database }),
      connectorId: queueInput.connectorId,
      database: queueInput.database,
      maxRows: queueInput.maxRows,
      organizationId: queueInput.organizationId,
      sql: queueInput.sql,
      timeoutMs: queueInput.timeoutMs,
      waitTimeoutMs: queueInput.waitTimeoutMs,
      workgroup: queueInput.workgroup,
    });

    return outcome.mapError(
      (error): ConnectorAthenaJobQueueFailure => ({
        cause: error,
        message: error.message,
        status: error.status,
        timedOut: input.isTimedOut?.(error) ?? false,
      })
    );
  };
}

export type AthenaConnectorQueryExecutor = {
  driver: ProviderQueryDriver<ConnectorCredentials>;
  executeConnectorQuery(
    creds: ConnectorCredentials,
    query: string,
    input: {
      db?: QueryExecutionContext["db"];
      timeoutMs?: number;
      organizationId: string;
    }
  ): Promise<DatabaseQueryResult<Record<string, unknown>[]>>;
  executeConnectorQueryWithStats(
    creds: ConnectorCredentials,
    query: string,
    input: {
      db?: QueryExecutionContext["db"];
      timeoutMs?: number;
      organizationId: string;
    }
  ): Promise<DatabaseQueryResult<DatabaseQueryExecution>>;
  runAthenaConnectorConnectionTest(
    credentials: ConnectorCredentials,
    context: QueryExecutionContext,
    deadline?: QueryDeadline
  ): Promise<DataSourceTestOutcome>;
};

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
  dependencies: AthenaConnectorQueryDriverDependencies,
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

  const outcome = await dependencies.queueJob({
    context: input.context,
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

  if (outcome.error.timedOut) {
    return Result.err(
      new QueryTimeoutFailure({
        cause: outcome.error.cause,
        message: outcome.error.message,
        provider: "aws_athena_connector",
        retryable: true,
        timedOut: true,
      })
    );
  }

  return Result.err(
    new ProviderTransportFailure({
      cause: outcome.error.cause,
      message: outcome.error.message,
      provider: "aws_athena_connector",
      retryable: outcome.error.status >= 500,
    })
  );
}

export function createAthenaConnectorQueryExecutor(
  dependencies: AthenaConnectorQueryDriverDependencies
): AthenaConnectorQueryExecutor {
  const executeConnectorQuery = async (
    creds: ConnectorCredentials,
    query: string,
    input: {
      db?: QueryExecutionContext["db"];
      timeoutMs?: number;
      organizationId: string;
    }
  ): Promise<DatabaseQueryResult<Record<string, unknown>[]>> => {
    const outcome = await executeConnectorAthenaJob(
      dependencies,
      creds,
      query,
      {
        context: {
          db: input.db,
          organizationId: input.organizationId,
        },
        timeoutMs: input.timeoutMs,
      }
    );
    return outcome.map((value) =>
      normalizeColumnRows(value.columns, value.rows)
    );
  };

  const executeConnectorQueryWithStats = async (
    creds: ConnectorCredentials,
    query: string,
    input: {
      db?: QueryExecutionContext["db"];
      timeoutMs?: number;
      organizationId: string;
    }
  ): Promise<DatabaseQueryResult<DatabaseQueryExecution>> => {
    const outcome = await executeConnectorAthenaJob(
      dependencies,
      creds,
      query,
      {
        context: {
          db: input.db,
          organizationId: input.organizationId,
        },
        timeoutMs: input.timeoutMs,
      }
    );
    return outcome.map((value) => ({
      rows: normalizeColumnRows(value.columns, value.rows),
      stats: buildAthenaConnectorStats({
        creds,
        outcome: value,
      }),
    }));
  };

  const runConnectionTest = (
    credentials: ConnectorCredentials,
    context: QueryExecutionContext,
    deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
  ) =>
    runAthenaConnectorConnectionTest(
      executeConnectorQuery,
      credentials,
      context,
      deadline
    );

  const driver = {
    provider: "aws_athena_connector",
    capabilities: {
      cancellation: "best_effort",
      connectionTest: true,
      dryRun: false,
      stats: true,
    },
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
      runConnectionTest(credentials, context, deadline),
  } satisfies ProviderQueryDriver<ConnectorCredentials>;

  return {
    driver,
    executeConnectorQuery,
    executeConnectorQueryWithStats,
    runAthenaConnectorConnectionTest: runConnectionTest,
  };
}

export function createAthenaConnectorQueryDriver(
  dependencies: AthenaConnectorQueryDriverDependencies
): ProviderQueryDriver<ConnectorCredentials> {
  return createAthenaConnectorQueryExecutor(dependencies).driver;
}

async function runAthenaConnectorConnectionTest(
  executeConnectorQuery: AthenaConnectorQueryExecutor["executeConnectorQuery"],
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
