import {
  eq,
  getDatabaseSchema,
  isDatabaseCredentials,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { prepareDataSourceCredentials } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  DataSourceQueryExecutionError,
  executeDatabaseQuery,
} from "@onequery/server/services/data-source-query/execute-query";
import { validateAndNormalizeReadOnlyQuery } from "@onequery/server/services/data-source-query/validate-sql";

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

export async function runCliValidateQueryEffect(
  effect: CliValidateQueryEffect
): Promise<CliValidateQueryEffectResult> {
  const validation = await validateAndNormalizeReadOnlyQuery(
    effect.sql,
    effect.databaseType
  );

  if (!validation.ok) {
    return {
      detail: validation.error,
      kind: "query_rejected",
    };
  }

  return {
    kind: "query_ready",
    normalizedSql: validation.value.sql,
    truncated: validation.value.changed,
  };
}

export async function runCliLoadQueryCredentialsEffect(input: {
  db: Database;
  masterEncryptionKey: string;
  effect: CliLoadCredentialsEffect;
}): Promise<CliLoadCredentialsEffectResult> {
  const credentialsResult = await prepareDataSourceCredentials({
    dataSource: input.effect.source,
    masterEncryptionKey: input.masterEncryptionKey,
  });

  if (!credentialsResult.ok) {
    return {
      detail: credentialsResult.error,
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
}): Promise<CliExecuteSqlEffectResult> {
  const startedAtMs = Date.now();
  const execution = await Promise.resolve()
    .then(async () =>
      executeDatabaseQuery({
        credentials: input.effect.credentials,
        db: input.db,
        organizationId: input.effect.source.organizationId,
        sql: input.effect.sql,
        timeoutMs: input.effect.clientTimeoutMs,
      })
    )
    .then((rows) => ({ ok: true as const, rows }))
    .catch((error: unknown) => ({ error, ok: false as const }));

  if (!execution.ok) {
    return toCliQueryExecutionFailure(execution.error);
  }

  return {
    elapsedMs: Math.max(0, Math.trunc(Date.now() - startedAtMs)),
    kind: "succeeded",
    rows: execution.rows,
  };
}

export async function runCliPersistQueryUsageEffect(input: {
  db: Database;
  effect: CliPersistUsageEffect;
}): Promise<CliPersistUsageEffectResult> {
  const { dataSources } = getDatabaseSchema(input.db);
  const persisted = await input.db
    .update(dataSources)
    .set({ lastUsedAt: new Date() })
    .where(eq(dataSources.id, input.effect.sourceId))
    .then(() => ({ ok: true as const }))
    .catch((error: unknown) => ({ error, ok: false as const }));

  if (!persisted.ok) {
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
  error: unknown
): Exclude<CliExecuteSqlEffectResult, { kind: "succeeded" }> {
  const failure =
    error instanceof DataSourceQueryExecutionError
      ? error
      : new DataSourceQueryExecutionError(toErrorMessage(error));

  if (failure.timedOut) {
    return {
      detail: failure.message,
      kind: "query_timed_out",
      retryable: true,
    };
  }

  if (failure.retryable) {
    return {
      detail: failure.message,
      kind: "query_unavailable",
      retryable: true,
    };
  }

  return {
    detail: failure.message,
    kind: "query_execution_failed",
    retryable: false,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
