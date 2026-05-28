import {
  dataSourceQueryCosts,
  dataSources,
  eq,
  isDatabaseCredentials,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { prepareDataSourceCredentials as prepareDataSourceCredentialsDefault } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  executeBigQueryQueryWithStats as executeBigQueryQueryWithStatsDefault,
  executeDatabaseQueryWithStats as executeDatabaseQueryWithStatsDefault,
  getQueryFailureFlags,
  executeValidatedDatabaseQuery as executeValidatedDatabaseQueryDefault,
  toErrorMessage,
} from "@onequery/server/services/data-source-query/execute-query";
import type {
  DatabaseQueryExecution,
  DatabaseQueryExecutionStats,
  DatabaseQueryResult,
  DataSourceQueryFailure,
} from "@onequery/server/services/data-source-query/execute-query";
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

export type CliQueryEffectDependencies = {
  executeBigQueryQueryWithStats: typeof executeBigQueryQueryWithStatsDefault;
  executeDatabaseQueryWithStats: typeof executeDatabaseQueryWithStatsDefault;
  executeValidatedDatabaseQuery: typeof executeValidatedDatabaseQueryDefault;
  prepareDataSourceCredentials: typeof prepareDataSourceCredentialsDefault;
};

const defaultCliQueryEffectDependencies = {
  executeBigQueryQueryWithStats: executeBigQueryQueryWithStatsDefault,
  executeDatabaseQueryWithStats: executeDatabaseQueryWithStatsDefault,
  executeValidatedDatabaseQuery: executeValidatedDatabaseQueryDefault,
  prepareDataSourceCredentials: prepareDataSourceCredentialsDefault,
} satisfies CliQueryEffectDependencies;

export async function runCliValidateQueryEffect(
  effect: CliValidateQueryEffect
): Promise<CliValidateQueryEffectResult> {
  const {
    classifyCliQueryValidationFailure,
    validateAndNormalizeReadOnlyQuery,
  } = await import("@onequery/server/services/data-source-query/validate-sql");
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
    | "executeBigQueryQueryWithStats"
    | "executeDatabaseQueryWithStats"
    | "executeValidatedDatabaseQuery"
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
  credentials: Parameters<
    typeof executeDatabaseQueryWithStatsDefault
  >[0]["credentials"];
  db: Parameters<typeof executeDatabaseQueryWithStatsDefault>[0]["db"];
  dependencies: Pick<
    CliQueryEffectDependencies,
    | "executeBigQueryQueryWithStats"
    | "executeDatabaseQueryWithStats"
    | "executeValidatedDatabaseQuery"
  >;
  normalizedSql: string;
  organizationId: string;
  timeoutMs: number | null | undefined;
}): Promise<DatabaseQueryResult<DatabaseQueryExecution>> {
  if (input.credentials.type === "bigquery") {
    return input.dependencies.executeBigQueryQueryWithStats(
      input.credentials,
      input.normalizedSql,
      {
        timeoutMs: input.timeoutMs,
      }
    );
  }

  if (input.credentials.type === "aws_athena_connector") {
    return input.dependencies.executeDatabaseQueryWithStats({
      credentials: input.credentials,
      db: input.db,
      organizationId: input.organizationId,
      sql: input.normalizedSql,
      timeoutMs: input.timeoutMs,
    });
  }

  const rows = await input.dependencies.executeValidatedDatabaseQuery({
    credentials: input.credentials,
    db: input.db,
    normalizedSql: input.normalizedSql,
    organizationId: input.organizationId,
    timeoutMs: input.timeoutMs,
  });

  return rows.map((value) => ({
    rows: value,
  }));
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
