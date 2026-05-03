import { dataSources, eq, isDatabaseCredentials } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { prepareDataSourceCredentials } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  DataSourceQueryExecutionError,
  executeValidatedDatabaseQuery,
} from "@onequery/server/services/data-source-query/execute-query";
import {
  classifyCliQueryValidationFailure,
  validateAndNormalizeReadOnlyQuery,
} from "@onequery/server/services/data-source-query/validate-sql";
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

export async function runCliValidateQueryEffect(
  effect: CliValidateQueryEffect
): Promise<CliValidateQueryEffectResult> {
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
    truncated: validation.value.changed,
  };
}

export async function runCliLoadQueryCredentialsEffect(input: {
  db: Database;
  masterEncryptionKey: Uint8Array;
  effect: CliLoadCredentialsEffect;
}): Promise<CliLoadCredentialsEffectResult> {
  const credentialsResult = await prepareDataSourceCredentials({
    dataSource: input.effect.source,
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
}): Promise<CliExecuteSqlEffectResult> {
  const startedAtMs = Date.now();
  const execution = await Result.tryPromise(async () =>
    executeValidatedDatabaseQuery({
      credentials: input.effect.credentials,
      db: input.db,
      normalizedSql: input.effect.normalizedSql,
      organizationId: input.effect.source.organizationId,
      timeoutMs: input.effect.clientTimeoutMs,
    })
  );

  if (execution.isErr()) {
    return toCliQueryExecutionFailure(execution.error);
  }

  return {
    elapsedMs: Math.max(0, Math.trunc(Date.now() - startedAtMs)),
    kind: "succeeded",
    rows: execution.value,
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
    };
  }

  if (failure.retryable) {
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
