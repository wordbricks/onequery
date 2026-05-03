import type { Database } from "@onequery/db/server";

import type { WorkflowActorSnapshot } from "../../../audit";
import type {
  CliLoadSourceEffectResult,
  CliPersistUsageEffectResult,
} from "../../../domain/effects";
import type {
  AccessibleCliOrg,
  CliQuerySourceRecord,
} from "../../../domain/workflows";
import { getCliQueryDatabaseProviderType } from "../../../source/model";
import {
  toCliSourceRecord,
  toQueryActionSourceDescriptor,
  toStoredQueryExecutionResult,
  toStoredQueryPreparationResult,
  toStoredUsagePersistenceResult,
} from "./workflow-codec";
import { buildCliQuerySuccessResponse } from "./workflow-result";
import {
  createQueryAuditProblem,
  dispatchStoredQueryActionEffect,
  loadRequiredCliQueryCredentials,
  loadRequiredCliQuerySourceRecord,
} from "./workflow-runtime";
import type {
  CliQueryExecutionDispatch,
  DispatchedQueryActionEffect,
  QueryExecutionEffectResult,
  QueryPreparationEffectResult,
  QueryWorkflowResourceCache,
  StoredAcceptedQueryActionDecision,
} from "./workflow-types";

type ValidationDispatch = {
  validateQuery: CliQueryExecutionDispatch["validateQuery"];
};

type ValidatePreparationDispatch = {
  loadSource: CliQueryExecutionDispatch["loadSource"];
} & ValidationDispatch;

type ExecutePreparationDispatch = ValidatePreparationDispatch & {
  loadCredentials: CliQueryExecutionDispatch["loadCredentials"];
};

type ExecutionDispatch = {
  executeSql: CliQueryExecutionDispatch["executeSql"];
  loadCredentials: CliQueryExecutionDispatch["loadCredentials"];
  loadSource: CliQueryExecutionDispatch["loadSource"];
};

type UsageDispatch = {
  persistUsage: CliQueryExecutionDispatch["persistUsage"];
};

export function createEmptyQueryWorkflowResourceCache(): QueryWorkflowResourceCache {
  return {
    loadedCredentials: null,
    loadedSource: null,
  };
}

async function loadQuerySourceForPreparation(input: {
  cachedSource: CliQuerySourceRecord | null;
  dispatch: Pick<ValidatePreparationDispatch, "loadSource">;
  organizationId: string;
  sourceKey: string;
}): Promise<CliLoadSourceEffectResult> {
  if (input.cachedSource !== null) {
    if (
      input.cachedSource.organizationId !== input.organizationId ||
      input.cachedSource.sourceKey !== input.sourceKey
    ) {
      throw createQueryAuditProblem(
        "cached query source does not match preparation effect"
      );
    }

    return {
      kind: "found",
      source: input.cachedSource,
    };
  }

  return input.dispatch.loadSource({
    kind: "load_source",
    organizationId: input.organizationId,
    sourceKey: input.sourceKey,
  });
}

export async function runQueryValidatePreparationStep(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  dispatch: ValidatePreparationDispatch;
  resourceCache: QueryWorkflowResourceCache;
  org: AccessibleCliOrg;
  requestId: string;
  sourceName: string;
}): Promise<{
  resourceCache: QueryWorkflowResourceCache;
  step: DispatchedQueryActionEffect<
    "prepare_validate_query",
    QueryPreparationEffectResult
  >;
}> {
  let loadedSource = input.resourceCache.loadedSource;

  const step = await dispatchStoredQueryActionEffect<
    "prepare_validate_query",
    QueryPreparationEffectResult
  >({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.db,
    expectedEffectType: "prepare_validate_query",
    organizationId: input.org.id,
    replay: ({ stored }) =>
      toStoredQueryPreparationResult({
        commandPayload: stored.commandPayload,
        decision: stored.decision,
        orgSlug: input.org.slug,
        requestId: input.requestId,
        sourceName: input.sourceName,
      }),
    requestId: input.requestId,
    run: async (effect) => {
      const source = await loadQuerySourceForPreparation({
        cachedSource: loadedSource,
        dispatch: input.dispatch,
        organizationId: effect.organizationId,
        sourceKey: effect.sourceKey,
      });

      if (source.kind === "not_found") {
        return {
          commandPayload: {
            kind: "not_found",
            sourceKey: effect.sourceKey,
            type: "record_validate_preparation",
          },
          result: {
            kind: "source_not_found",
            orgSlug: input.org.slug,
            requestId: input.requestId,
            sourceName: input.sourceName,
          } satisfies QueryPreparationEffectResult,
        };
      }

      const databaseType = getCliQueryDatabaseProviderType(
        source.source.provider,
        source.source.status
      );
      if (!databaseType) {
        return {
          commandPayload: {
            kind: "query_interface_missing",
            provider: source.source.provider,
            sourceStatus: source.source.status,
            type: "record_validate_preparation",
          },
          result: {
            kind: "source_query_interface_missing",
            provider: source.source.provider,
            requestId: input.requestId,
            sourceName: input.sourceName,
            status: source.source.status,
          } satisfies QueryPreparationEffectResult,
        };
      }

      loadedSource = source.source;
      const sourceDescriptor = toQueryActionSourceDescriptor(source.source);
      const validationResult = await input.dispatch.validateQuery({
        databaseType,
        kind: "validate_query",
        sql: effect.queryText,
      });

      if (validationResult.kind === "query_ready") {
        return {
          commandPayload: {
            kind: "accepted",
            source: sourceDescriptor,
            truncated: validationResult.truncated,
            type: "record_validate_preparation",
            validatedQuery: validationResult.normalizedSql,
          },
          result: {
            kind: "query_ready",
            normalizedSql: validationResult.normalizedSql,
            source: sourceDescriptor,
            truncated: validationResult.truncated,
          } satisfies QueryPreparationEffectResult,
        };
      }

      if (validationResult.kind === "query_preparation_failed") {
        return {
          commandPayload: {
            detail: validationResult.detail,
            hint: validationResult.hint,
            kind: "failed",
            source: sourceDescriptor,
            type: "record_validate_preparation",
          },
          result: validationResult satisfies QueryPreparationEffectResult,
        };
      }

      return {
        commandPayload: {
          detail: validationResult.detail,
          kind: "rejected",
          source: sourceDescriptor,
          type: "record_validate_preparation",
        },
        result: validationResult satisfies QueryPreparationEffectResult,
      };
    },
  });

  return {
    resourceCache: {
      ...input.resourceCache,
      loadedSource,
    },
    step,
  };
}

export async function runQueryExecutePreparationStep(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  dispatch: ExecutePreparationDispatch;
  resourceCache: QueryWorkflowResourceCache;
  org: AccessibleCliOrg;
  requestId: string;
  sourceName: string;
}): Promise<{
  resourceCache: QueryWorkflowResourceCache;
  step: DispatchedQueryActionEffect<
    "prepare_execute_query",
    QueryPreparationEffectResult
  >;
}> {
  let loadedCredentials = input.resourceCache.loadedCredentials;
  let loadedSource = input.resourceCache.loadedSource;

  const step = await dispatchStoredQueryActionEffect<
    "prepare_execute_query",
    QueryPreparationEffectResult
  >({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.db,
    expectedEffectType: "prepare_execute_query",
    organizationId: input.org.id,
    replay: ({ stored }) =>
      toStoredQueryPreparationResult({
        commandPayload: stored.commandPayload,
        decision: stored.decision,
        orgSlug: input.org.slug,
        requestId: input.requestId,
        sourceName: input.sourceName,
      }),
    requestId: input.requestId,
    run: async (effect) => {
      const source = await loadQuerySourceForPreparation({
        cachedSource: loadedSource,
        dispatch: input.dispatch,
        organizationId: effect.organizationId,
        sourceKey: effect.sourceKey,
      });

      if (source.kind === "not_found") {
        return {
          commandPayload: {
            kind: "not_found",
            sourceKey: effect.sourceKey,
            type: "record_execute_preparation",
          },
          result: {
            kind: "source_not_found",
            orgSlug: input.org.slug,
            requestId: input.requestId,
            sourceName: input.sourceName,
          } satisfies QueryPreparationEffectResult,
        };
      }

      const databaseType = getCliQueryDatabaseProviderType(
        source.source.provider,
        source.source.status
      );
      if (!databaseType) {
        return {
          commandPayload: {
            kind: "query_interface_missing",
            provider: source.source.provider,
            sourceStatus: source.source.status,
            type: "record_execute_preparation",
          },
          result: {
            kind: "source_query_interface_missing",
            provider: source.source.provider,
            requestId: input.requestId,
            sourceName: input.sourceName,
            status: source.source.status,
          } satisfies QueryPreparationEffectResult,
        };
      }

      loadedSource = source.source;
      const sourceDescriptor = toQueryActionSourceDescriptor(source.source);
      const validationResult = await input.dispatch.validateQuery({
        databaseType,
        kind: "validate_query",
        sql: effect.queryText,
      });

      if (validationResult.kind === "query_rejected") {
        return {
          commandPayload: {
            detail: validationResult.detail,
            kind: "rejected",
            source: sourceDescriptor,
            type: "record_execute_preparation",
          },
          result: validationResult satisfies QueryPreparationEffectResult,
        };
      }

      if (validationResult.kind === "query_preparation_failed") {
        return {
          commandPayload: {
            detail: validationResult.detail,
            hint: validationResult.hint,
            kind: "failed",
            source: sourceDescriptor,
            type: "record_execute_preparation",
          },
          result: validationResult satisfies QueryPreparationEffectResult,
        };
      }

      const credentialsResult = await input.dispatch.loadCredentials({
        kind: "load_credentials",
        source: source.source,
      });

      if (credentialsResult.kind !== "credentials_loaded") {
        return {
          commandPayload: {
            detail: credentialsResult.detail,
            hint: "verify the source configuration and retry",
            kind: "failed",
            source: sourceDescriptor,
            type: "record_execute_preparation",
          },
          result: {
            detail: credentialsResult.detail,
            hint: "verify the source configuration and retry",
            kind: "query_preparation_failed",
          } satisfies QueryPreparationEffectResult,
        };
      }

      loadedCredentials = credentialsResult.credentials;

      return {
        commandPayload: {
          kind: "succeeded",
          source: sourceDescriptor,
          truncated: validationResult.truncated,
          type: "record_execute_preparation",
          validatedQuery: validationResult.normalizedSql,
        },
        result: {
          kind: "query_ready",
          normalizedSql: validationResult.normalizedSql,
          source: sourceDescriptor,
          truncated: validationResult.truncated,
        } satisfies QueryPreparationEffectResult,
      };
    },
  });

  return {
    resourceCache: {
      loadedCredentials,
      loadedSource,
    },
    step,
  };
}

export async function runQueryExecutionStep(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  dispatch: ExecutionDispatch;
  resourceCache: QueryWorkflowResourceCache;
  organizationId: string;
  requestId: string;
  timeoutMs: number;
  truncated: boolean;
}): Promise<
  DispatchedQueryActionEffect<"execute_query", QueryExecutionEffectResult>
> {
  let loadedCredentials = input.resourceCache.loadedCredentials;
  let loadedSource = input.resourceCache.loadedSource;

  return dispatchStoredQueryActionEffect<
    "execute_query",
    QueryExecutionEffectResult
  >({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.db,
    expectedEffectType: "execute_query",
    organizationId: input.organizationId,
    replay: ({ stored }) => toStoredQueryExecutionResult(stored.commandPayload),
    requestId: input.requestId,
    run: async (effect) => {
      const source = await loadRequiredCliQuerySourceRecord({
        cachedSource: loadedSource,
        dispatch: input.dispatch,
        sourceDescriptor: effect.source,
      });
      loadedSource = source;

      const queryCredentials = await loadRequiredCliQueryCredentials({
        cachedCredentials: loadedCredentials,
        dispatch: input.dispatch,
        source,
      });
      loadedCredentials = queryCredentials;

      const executionResult = await input.dispatch.executeSql({
        clientTimeoutMs: input.timeoutMs,
        credentials: queryCredentials,
        kind: "execute_sql",
        normalizedSql: effect.validatedQuery,
        requestId: input.requestId,
        source,
      });

      if (executionResult.kind === "succeeded") {
        const response = buildCliQuerySuccessResponse({
          elapsedMs: executionResult.elapsedMs,
          rows: executionResult.rows,
          source: toCliSourceRecord(effect.source),
          truncated: input.truncated,
        });

        return {
          commandPayload: {
            kind: "succeeded",
            response,
            type: "record_query_execution",
          },
          result: {
            kind: "succeeded",
            response,
          },
        };
      }

      switch (executionResult.kind) {
        case "query_unavailable":
          return {
            commandPayload: {
              detail: executionResult.detail,
              kind: "unavailable",
              type: "record_query_execution",
            },
            result: {
              detail: executionResult.detail,
              kind: "query_unavailable",
            },
          };
        case "query_timed_out":
          return {
            commandPayload: {
              detail: executionResult.detail,
              kind: "timed_out",
              type: "record_query_execution",
            },
            result: {
              detail: executionResult.detail,
              kind: "query_timed_out",
            },
          };
        case "query_execution_failed":
          return {
            commandPayload: {
              detail: executionResult.detail,
              kind: "failed",
              type: "record_query_execution",
            },
            result: {
              detail: executionResult.detail,
              kind: "query_execution_failed",
            },
          };
      }
    },
  });
}

export async function runQueryUsagePersistenceStep(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  dispatch: UsageDispatch;
  organizationId: string;
  requestId: string;
}): Promise<
  DispatchedQueryActionEffect<"persist_usage", CliPersistUsageEffectResult>
> {
  return dispatchStoredQueryActionEffect<
    "persist_usage",
    CliPersistUsageEffectResult
  >({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.db,
    expectedEffectType: "persist_usage",
    organizationId: input.organizationId,
    replay: ({ effect, stored }) =>
      toStoredUsagePersistenceResult({
        decision: stored.decision,
        sourceId: effect.sourceId,
      }),
    requestId: input.requestId,
    run: async (effect) => {
      const usageResult = await input.dispatch.persistUsage({
        kind: "persist_usage",
        sourceId: effect.sourceId,
      });

      if (usageResult.kind === "usage_persisted") {
        return {
          commandPayload: {
            kind: "succeeded",
            type: "record_usage_persistence",
          },
          result: usageResult,
        };
      }

      return {
        commandPayload: {
          detail: usageResult.detail,
          kind: "failed",
          type: "record_usage_persistence",
        },
        result: usageResult,
      };
    },
  });
}
