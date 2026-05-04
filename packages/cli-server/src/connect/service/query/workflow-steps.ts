import type { Database } from "@onequery/db/server";

import type { WorkflowActorSnapshot } from "../../../audit";
import type { CliPersistUsageEffectResult } from "../../../domain/effects";
import type { AccessibleCliOrg } from "../../../domain/workflows";
import { getCliQueryDatabaseProviderType } from "../../../source/model";
import { loadQuerySourceLookup } from "./resource-cache";
import type { QueryWorkflowResourceCache } from "./resource-cache";
import {
  toCliSourceRecord,
  toQueryActionSourceDescriptor,
  toStoredQueryExecutionResult,
  toStoredQueryPreparationResult,
  toStoredUsagePersistenceResult,
} from "./workflow-codec";
import { buildCliQuerySuccessResponse } from "./workflow-result";
import {
  dispatchStoredQueryActionEffect,
  loadRequiredCliQueryCredentials,
  loadRequiredCliQuerySourceRecord,
} from "./workflow-runtime";
import type {
  CliQueryExecutionDispatch,
  DispatchedQueryActionEffect,
  QueryExecutionEffectResult,
  QueryPreparationEffectResult,
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
  let sourceLookup = input.resourceCache.sourceLookup;

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
      const lookup = await loadQuerySourceLookup({
        cached: sourceLookup,
        dispatch: input.dispatch,
        organizationId: effect.organizationId,
        sourceKey: effect.sourceKey,
        use: "preparation effect",
      });
      sourceLookup = lookup;

      if (lookup.result.kind === "not_found") {
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
        lookup.result.source.provider,
        lookup.result.source.status
      );
      if (!databaseType) {
        return {
          commandPayload: {
            kind: "query_interface_missing",
            provider: lookup.result.source.provider,
            sourceStatus: lookup.result.source.status,
            type: "record_validate_preparation",
          },
          result: {
            kind: "source_query_interface_missing",
            provider: lookup.result.source.provider,
            requestId: input.requestId,
            sourceName: input.sourceName,
            status: lookup.result.source.status,
          } satisfies QueryPreparationEffectResult,
        };
      }

      const sourceDescriptor = toQueryActionSourceDescriptor(
        lookup.result.source
      );
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
      sourceLookup,
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
  let credentials = input.resourceCache.credentials;
  let sourceLookup = input.resourceCache.sourceLookup;

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
      const lookup = await loadQuerySourceLookup({
        cached: sourceLookup,
        dispatch: input.dispatch,
        organizationId: effect.organizationId,
        sourceKey: effect.sourceKey,
        use: "preparation effect",
      });
      sourceLookup = lookup;

      if (lookup.result.kind === "not_found") {
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
        lookup.result.source.provider,
        lookup.result.source.status
      );
      if (!databaseType) {
        return {
          commandPayload: {
            kind: "query_interface_missing",
            provider: lookup.result.source.provider,
            sourceStatus: lookup.result.source.status,
            type: "record_execute_preparation",
          },
          result: {
            kind: "source_query_interface_missing",
            provider: lookup.result.source.provider,
            requestId: input.requestId,
            sourceName: input.sourceName,
            status: lookup.result.source.status,
          } satisfies QueryPreparationEffectResult,
        };
      }

      const sourceDescriptor = toQueryActionSourceDescriptor(
        lookup.result.source
      );
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
        source: lookup.result.source,
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

      credentials = credentialsResult.credentials;

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
      credentials,
      sourceLookup,
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
        dispatch: input.dispatch,
        sourceLookup: input.resourceCache.sourceLookup,
        sourceDescriptor: effect.source,
      });

      const queryCredentials = await loadRequiredCliQueryCredentials({
        cachedCredentials: input.resourceCache.credentials,
        dispatch: input.dispatch,
        source,
      });

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
