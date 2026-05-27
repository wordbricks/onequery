import {
  dataSourceQueryCosts,
  dataSources,
  eq,
  isDatabaseCredentials,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import type { DatabaseCredentials } from "@onequery/query";
import { createQueryNodeRuntime } from "@onequery/query-node";
import type {
  ConnectorAthenaJobQueue,
  ConnectorAthenaJobQueueFailure,
} from "@onequery/query-node/providers/athena-connector/driver";
import { getQueryFailureFlags, toErrorMessage } from "@onequery/query/errors";
import type { DataSourceQueryFailure } from "@onequery/query/errors";
import type {
  DatabaseQueryExecution,
  DatabaseQueryExecutionStats,
  DatabaseQueryResult,
} from "@onequery/query/types";
import {
  ConnectorJobTimeoutError,
  queueConnectorAthenaJob,
} from "@onequery/server/services/connectors/broker";
import { prepareDataSourceCredentials as prepareDataSourceCredentialsDefault } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import { Result } from "better-result";

import type {
  CliExecuteSqlEffect,
  CliExecuteSqlEffectResult,
  CliLoadCredentialsEffect,
  CliLoadCredentialsEffectResult,
  CliPersistUsageEffect,
  CliPersistUsageEffectResult,
  CliValidateQueryEffect,
  CliValidateQueryEffectResult,
} from "../domain/effects";

type ExecuteValidatedDatabaseQueryWithStatsInput = {
  credentials: DatabaseCredentials;
  db?: Database;
  normalizedSql: string;
  organizationId: string;
  timeoutMs?: number | null;
};

type ExecuteValidatedDatabaseQueryWithStats = (
  input: ExecuteValidatedDatabaseQueryWithStatsInput
) => Promise<DatabaseQueryResult<DatabaseQueryExecution>>;

export type CliQueryEffectDependencies = {
  executeValidatedDatabaseQueryWithStats: ExecuteValidatedDatabaseQueryWithStats;
  prepareDataSourceCredentials: typeof prepareDataSourceCredentialsDefault;
};

const queueCliConnectorAthenaJob: ConnectorAthenaJobQueue = async (input) => {
  const outcome = await queueConnectorAthenaJob({
    ...(input.context.db ? { db: input.context.db as Database } : {}),
    connectorId: input.connectorId,
    database: input.database,
    maxRows: input.maxRows,
    organizationId: input.organizationId,
    sql: input.sql,
    timeoutMs: input.timeoutMs,
    waitTimeoutMs: input.waitTimeoutMs,
    workgroup: input.workgroup,
  });

  return outcome.mapError(
    (error): ConnectorAthenaJobQueueFailure => ({
      cause: error,
      message: error.message,
      status: error.status,
      timedOut: error instanceof ConnectorJobTimeoutError,
    })
  );
};

const defaultQueryRuntime = createQueryNodeRuntime({
  athenaConnector: {
    queueJob: queueCliConnectorAthenaJob,
  },
});

const executeValidatedDatabaseQueryWithStatsDefault: ExecuteValidatedDatabaseQueryWithStats =
  (input) =>
    defaultQueryRuntime.service.executeValidatedDatabaseQueryWithStats({
      context: {
        db: input.db,
        organizationId: input.organizationId,
      },
      credentials: input.credentials,
      normalizedSql: input.normalizedSql,
      timeoutMs: input.timeoutMs,
    });

const defaultCliQueryEffectDependencies = {
  executeValidatedDatabaseQueryWithStats:
    executeValidatedDatabaseQueryWithStatsDefault,
  prepareDataSourceCredentials: prepareDataSourceCredentialsDefault,
} satisfies CliQueryEffectDependencies;

export async function runCliValidateQueryEffect(
  effect: CliValidateQueryEffect
): Promise<CliValidateQueryEffectResult> {
  const {
    classifyCliQueryValidationFailure,
    validateAndNormalizeReadOnlyQuery,
  } = await import("@onequery/sql-polyglot");
  const validation = await validateAndNormalizeReadOnlyQuery(
    effect.sql,
    effect.databaseType
  );

  if (validation.isErr()) {
    return classifyCliQueryValidationFailure(validation.error);
  }

  return {
    kind: "query_ready",
    normalizedSql: validation.value.sql,
    truncated: false,
  };
}

export async function runCliLoadQueryCredentialsEffect(input: {
  db: Database;
  googleOAuthConfig?: {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
  };
  masterEncryptionKey: Uint8Array;
  effect: CliLoadCredentialsEffect;
  dependencies?: Pick<
    CliQueryEffectDependencies,
    "prepareDataSourceCredentials"
  >;
}): Promise<CliLoadCredentialsEffectResult> {
  const dependencies = input.dependencies ?? defaultCliQueryEffectDependencies;
  const credentialsResult = await dependencies.prepareDataSourceCredentials({
    db: input.db,
    dataSource: input.effect.source,
    googleOAuthConfig: input.googleOAuthConfig,
    masterEncryptionKey: input.masterEncryptionKey,
  });

  if (credentialsResult.isErr()) {
    return {
      detail: credentialsResult.error.message,
      kind: "credentials_invalid",
      source: input.effect.source,
    };
  }

  if (!isDatabaseCredentials(credentialsResult.value.credentials)) {
    return {
      detail: "source credentials are not a database connection",
      kind: "credentials_invalid",
      source: input.effect.source,
    };
  }

  return {
    credentials: credentialsResult.value.credentials,
    kind: "credentials_loaded",
    source: input.effect.source,
  };
}

export async function runCliExecuteSqlEffect(input: {
  db: Database;
  effect: CliExecuteSqlEffect;
  dependencies?: Pick<
    CliQueryEffectDependencies,
    "executeValidatedDatabaseQueryWithStats"
  >;
}): Promise<CliExecuteSqlEffectResult> {
  const dependencies = input.dependencies ?? defaultCliQueryEffectDependencies;
  const startedAtMs = Date.now();
  const execution = await executeValidatedQueryWithOptionalStats({
    credentials: input.effect.credentials,
    db: input.db,
    dependencies,
    normalizedSql: input.effect.normalizedSql,
    organizationId: input.effect.source.organizationId,
    timeoutMs: input.effect.clientTimeoutMs,
  });

  if (execution.isErr()) {
    return toCliQueryExecutionFailure(execution.error);
  }

  if (execution.value.stats) {
    await persistCliQueryCostBestEffort({
      connectionName: input.effect.source.sourceKey,
      db: input.db,
      organizationId: input.effect.source.organizationId,
      queryId: input.effect.actionId,
      stats: execution.value.stats,
      toolCallId: input.effect.actionId,
    });
  }

  return {
    elapsedMs: Math.max(0, Math.trunc(Date.now() - startedAtMs)),
    kind: "succeeded",
    rows: execution.value.rows,
  };
}

async function executeValidatedQueryWithOptionalStats(input: {
  credentials: DatabaseCredentials;
  db: Database;
  dependencies: Pick<
    CliQueryEffectDependencies,
    "executeValidatedDatabaseQueryWithStats"
  >;
  normalizedSql: string;
  organizationId: string;
  timeoutMs: number | null | undefined;
}): Promise<DatabaseQueryResult<DatabaseQueryExecution>> {
  return input.dependencies.executeValidatedDatabaseQueryWithStats({
    credentials: input.credentials,
    db: input.db,
    normalizedSql: input.normalizedSql,
    organizationId: input.organizationId,
    timeoutMs: input.timeoutMs,
  });
}

async function persistCliQueryCostBestEffort(input: {
  db: Database;
  organizationId: string;
  connectionName: string;
  queryId: string;
  toolCallId: string;
  stats: DatabaseQueryExecutionStats;
}) {
  await input.db
    .insert(dataSourceQueryCosts)
    .values(buildDataSourceQueryCostRow(input))
    .catch((error: unknown) => {
      console.warn("[cli-query] Failed to persist query cost", {
        connectionName: input.connectionName,
        error: toErrorMessage(error),
        organizationId: input.organizationId,
        queryId: input.queryId,
      });
    });
}

function buildDataSourceQueryCostRow(input: {
  organizationId: string;
  connectionName: string;
  queryId: string;
  toolCallId: string;
  stats: DatabaseQueryExecutionStats;
}): typeof dataSourceQueryCosts.$inferInsert {
  const base = {
    organizationId: input.organizationId,
    provider: input.stats.provider,
    queryId: input.queryId,
    toolCallId: input.toolCallId,
    connectionName: input.connectionName,
    executedAt: new Date(),
    billableBytes: input.stats.billableBytes,
    actualCostUsd: input.stats.actualCostUsd,
    currency: input.stats.currency,
    pricingModel: input.stats.pricingModel,
  } satisfies Partial<typeof dataSourceQueryCosts.$inferInsert>;

  if (input.stats.provider === "bigquery") {
    return {
      ...base,
      estimatedProcessedBytes: input.stats.estimatedProcessedBytes,
      actualProcessedBytes: input.stats.actualProcessedBytes,
      estimatedCostUsd: input.stats.estimatedCostUsd,
      cacheHit: input.stats.cacheHit,
      jobId: input.stats.jobId,
      location: input.stats.location,
    };
  }

  return {
    ...base,
    connectorId: input.stats.connectorId,
    database: input.stats.database,
    executionTimeMs: input.stats.executionTimeMs,
    jobId: input.stats.connectorJobId,
    queryExecutionId: input.stats.athenaQueryExecutionId,
    rowCount: input.stats.rowCount,
    workgroup: input.stats.workgroup,
  };
}

export async function runCliPersistQueryUsageEffect(input: {
  db: Database;
  effect: CliPersistUsageEffect;
}): Promise<CliPersistUsageEffectResult> {
  const persisted = await Result.tryPromise(async () => {
    await input.db
      .update(dataSources)
      .set({ lastUsedAt: new Date() })
      .where(eq(dataSources.id, input.effect.sourceId));
  });

  if (persisted.isErr()) {
    return {
      detail: toErrorMessage(persisted.error),
      kind: "usage_persist_failed",
      sourceId: input.effect.sourceId,
    };
  }

  return {
    kind: "usage_persisted",
  };
}

function toCliQueryExecutionFailure(
  failure: DataSourceQueryFailure
): Exclude<CliExecuteSqlEffectResult, { kind: "succeeded" }> {
  const flags = getQueryFailureFlags(failure);

  if (flags.timedOut) {
    return {
      detail: failure.message,
      kind: "query_timed_out",
    };
  }

  if (flags.retryable) {
    return {
      detail: failure.message,
      kind: "query_unavailable",
    };
  }

  return {
    detail: failure.message,
    kind: "query_execution_failed",
  };
}
