import type { Database } from "@onequery/db/server";

import type { WorkflowActorSnapshot } from "../../../audit";
import type {
  CliPersistUsageEffectResult,
  CliValidateQueryEffectResult,
} from "../../../domain/effects";
import type { AccessibleCliOrg } from "../../../domain/workflows";
import { getCliQueryDatabaseProviderType } from "../../../source/model";
import {
  toCliSourceRecord,
  toQueryActionSourceDescriptor,
  toStoredQueryCredentialsLoadResult,
  toStoredQueryExecutionResult,
  toStoredQuerySourceLookupResult,
  toStoredQueryValidationResult,
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
  QueryCredentialsLoadResult,
  QueryExecutionEffectResult,
  QuerySourceLookupResult,
  QueryWorkflowResourceCache,
  StoredAcceptedQueryActionDecision,
} from "./workflow-types";

type SourceLookupDispatch = {
  loadSource: CliQueryExecutionDispatch["loadSource"];
};

type ValidationDispatch = {
  validateQuery: CliQueryExecutionDispatch["validateQuery"];
};

type CredentialsDispatch = {
  loadCredentials: CliQueryExecutionDispatch["loadCredentials"];
  loadSource: CliQueryExecutionDispatch["loadSource"];
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

export async function runQuerySourceLookupStep(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  dispatch: SourceLookupDispatch;
  resourceCache: QueryWorkflowResourceCache;
  org: AccessibleCliOrg;
  requestId: string;
  sourceName: string;
}): Promise<{
  resourceCache: QueryWorkflowResourceCache;
  step: DispatchedQueryActionEffect<"load_source", QuerySourceLookupResult>;
}> {
  let loadedSource = input.resourceCache.loadedSource;

  const step = await dispatchStoredQueryActionEffect<
    "load_source",
    QuerySourceLookupResult
  >({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.db,
    expectedEffectType: "load_source",
    organizationId: input.org.id,
    replay: ({ stored }) =>
      toStoredQuerySourceLookupResult({
        decision: stored.decision,
        orgSlug: input.org.slug,
        requestId: input.requestId,
        sourceName: input.sourceName,
      }),
    requestId: input.requestId,
    run: async (effect) => {
      const source = await input.dispatch.loadSource({
        kind: "load_source",
        organizationId: effect.organizationId,
        sourceKey: effect.sourceKey,
      });

      if (source.kind === "not_found") {
        return {
          commandPayload: {
            kind: "not_found",
            sourceKey: effect.sourceKey,
            type: "record_source_lookup",
          },
          result: {
            kind: "source_not_found",
            orgSlug: input.org.slug,
            requestId: input.requestId,
            sourceName: input.sourceName,
          } satisfies QuerySourceLookupResult,
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
            type: "record_source_lookup",
          },
          result: {
            kind: "source_query_interface_missing",
            provider: source.source.provider,
            requestId: input.requestId,
            sourceName: input.sourceName,
            status: source.source.status,
          } satisfies QuerySourceLookupResult,
        };
      }

      loadedSource = source.source;
      return {
        commandPayload: {
          kind: "found",
          source: toQueryActionSourceDescriptor(source.source),
          type: "record_source_lookup",
        },
        result: {
          kind: "source_query_interface_loaded",
        },
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

export async function runQueryValidationStep(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  dispatch: ValidationDispatch;
  organizationId: string;
  requestId: string;
}): Promise<
  DispatchedQueryActionEffect<"validate_query", CliValidateQueryEffectResult>
> {
  return dispatchStoredQueryActionEffect<
    "validate_query",
    CliValidateQueryEffectResult
  >({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.db,
    expectedEffectType: "validate_query",
    organizationId: input.organizationId,
    replay: ({ stored }) =>
      toStoredQueryValidationResult(stored.commandPayload),
    requestId: input.requestId,
    run: async (effect) => {
      const databaseType = getCliQueryDatabaseProviderType(
        effect.source.provider,
        effect.source.sourceStatus
      );
      if (!databaseType) {
        throw createQueryAuditProblem(
          `query_action validate_query effect lost the query interface for source "${effect.source.sourceKey}"`
        );
      }

      const validationResult = await input.dispatch.validateQuery({
        databaseType,
        kind: "validate_query",
        sql: effect.queryText,
      });

      if (validationResult.kind === "query_ready") {
        return {
          commandPayload: {
            kind: "accepted",
            truncated: validationResult.truncated,
            type: "record_query_validation",
            validatedQuery: validationResult.normalizedSql,
          },
          result: validationResult,
        };
      }

      if (validationResult.kind === "query_preparation_failed") {
        return {
          commandPayload: {
            detail: validationResult.detail,
            hint: validationResult.hint,
            kind: "preparation_failed",
            type: "record_query_validation",
          },
          result: validationResult,
        };
      }

      return {
        commandPayload: {
          detail: validationResult.detail,
          kind: "rejected",
          type: "record_query_validation",
        },
        result: validationResult,
      };
    },
  });
}

export async function runQueryCredentialsLoadStep(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  dispatch: CredentialsDispatch;
  resourceCache: QueryWorkflowResourceCache;
  organizationId: string;
  requestId: string;
}): Promise<{
  resourceCache: QueryWorkflowResourceCache;
  step: DispatchedQueryActionEffect<
    "load_credentials",
    QueryCredentialsLoadResult
  >;
}> {
  let loadedCredentials = input.resourceCache.loadedCredentials;
  let loadedSource = input.resourceCache.loadedSource;

  const step = await dispatchStoredQueryActionEffect<
    "load_credentials",
    QueryCredentialsLoadResult
  >({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.db,
    expectedEffectType: "load_credentials",
    organizationId: input.organizationId,
    replay: ({ stored }) => toStoredQueryCredentialsLoadResult(stored.decision),
    requestId: input.requestId,
    run: async (effect) => {
      const source = await loadRequiredCliQuerySourceRecord({
        cachedSource: loadedSource,
        dispatch: input.dispatch,
        sourceDescriptor: effect.source,
      });
      loadedSource = source;

      const credentialsResult = await input.dispatch.loadCredentials({
        kind: "load_credentials",
        source,
      });

      if (credentialsResult.kind === "credentials_loaded") {
        loadedCredentials = credentialsResult.credentials;

        return {
          commandPayload: {
            kind: "loaded",
            type: "record_credentials_load",
          },
          result: {
            kind: "loaded",
          },
        };
      }

      return {
        commandPayload: {
          detail: credentialsResult.detail,
          hint: "verify the source configuration and retry",
          kind: "preparation_failed",
          type: "record_credentials_load",
        },
        result: {
          detail: credentialsResult.detail,
          kind: "credentials_invalid",
        },
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
