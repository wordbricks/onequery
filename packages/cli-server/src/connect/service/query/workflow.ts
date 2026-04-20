import { and, asc, eq, workflowEffectDispatches } from "@onequery/db/server";
import type { Database, DatabaseCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import {
  QueryActionEffectSchema,
  storeQueryActionCommand,
} from "../../../audit";
import type {
  QueryActionCommand,
  QueryActionCommandPayload,
  QueryActionEffect,
  QueryActionEvent,
  QueryActionSourceDescriptor,
  StoredWorkflowDecision,
  WorkflowActorSnapshot,
} from "../../../audit";
import type {
  CliLoadCredentialsEffectResult,
  CliPersistUsageEffectResult,
  CliValidateQueryEffectResult,
} from "../../../domain/effects";
import type {
  AccessibleCliOrg,
  CliQueryExecutionResult,
  CliQuerySourceRecord,
} from "../../../domain/workflows";
import { toCliErrorMessage } from "../../../observability";
import { getCliQueryableDatabaseProviderType } from "../../../source/model";
import { CliConnectProblem } from "../../error";
import { createCliServiceProblem } from "../result";
import type { CliServiceResult } from "../result";
import type {
  createCliQueryExecutionDispatch,
  createCliQueryValidationDispatch,
} from "./dispatch";
import { buildCliQuerySuccessResponse } from "./workflow-result";
import type {
  CliQueryExecutionWorkflowResult,
  CliQueryValidationWorkflowResult,
} from "./workflow-result";

const EFFECT_LEASE_DURATION_MS = 30_000;

type CliQueryExecutionDispatch = ReturnType<
  typeof createCliQueryExecutionDispatch
>;
type CliQueryValidationDispatch = ReturnType<
  typeof createCliQueryValidationDispatch
>;

type QueryWorkflowRuntimeBaseInput = {
  actorSnapshot: WorkflowActorSnapshot;
  db: Database;
  org: AccessibleCliOrg;
  requestId: string;
  sourceName: string;
  sql: string;
  timeoutMs: number | null | undefined;
};

type StoredAcceptedQueryActionDecision = Extract<
  StoredWorkflowDecision<"query_action", QueryActionEvent, string>,
  { kind: "accepted" }
>;

type LoadedQueryActionEffect = {
  attemptCount: number;
  effect: QueryActionEffect;
  effectKey: string;
  id: string;
  originEventId: string;
};

type QueryableSourceLoadedResult = {
  kind: "queryable_source_loaded";
};

type QueryExecutionSourceLookupResult =
  | QueryableSourceLoadedResult
  | Extract<CliQueryExecutionWorkflowResult, { kind: "source_not_found" }>
  | Extract<CliQueryExecutionWorkflowResult, { kind: "source_not_queryable" }>;

type QueryValidationSourceLookupResult =
  | QueryableSourceLoadedResult
  | Extract<CliQueryValidationWorkflowResult, { kind: "source_not_found" }>
  | Extract<CliQueryValidationWorkflowResult, { kind: "source_not_queryable" }>;

export async function runCliQueryExecutionWorkflowResult(
  input: QueryWorkflowRuntimeBaseInput & {
    dispatch: CliQueryExecutionDispatch;
  }
): Promise<CliServiceResult<CliQueryExecutionWorkflowResult>> {
  return Result.tryPromise({
    try: async (): Promise<CliQueryExecutionWorkflowResult> => {
      const timeoutMs = input.timeoutMs ?? null;
      let loadedSource: CliQuerySourceRecord | null = null;
      let loadedCredentials: DatabaseCredentials | null = null;
      let successfulResponse:
        | Extract<
            CliQueryExecutionWorkflowResult,
            { kind: "response_ready" }
          >["response"]
        | null = null;

      const startDecision = await storeAcceptedQueryActionCommand({
        actionId: null,
        actorSnapshot: input.actorSnapshot,
        causedByEventId: null,
        commandInvocationId: `query_action:${input.requestId}:start_execute`,
        commandPayload: {
          queryText: input.sql,
          sourceKey: input.sourceName,
          type: "start_execute",
        },
        db: input.db,
        organizationId: input.org.id,
        requestId: input.requestId,
        surface: "cli",
      });

      const sourceLookup = await dispatchStoredQueryActionEffect<
        "load_source",
        QueryExecutionSourceLookupResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: startDecision,
        db: input.db,
        expectedEffectType: "load_source",
        organizationId: input.org.id,
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
              } satisfies CliQueryExecutionWorkflowResult,
            };
          }

          const databaseType = getCliQueryableDatabaseProviderType(
            source.source.provider,
            source.source.status
          );
          if (!databaseType) {
            return {
              commandPayload: {
                kind: "not_queryable",
                provider: source.source.provider,
                sourceStatus: source.source.status,
                type: "record_source_lookup",
              },
              result: {
                kind: "source_not_queryable",
                provider: source.source.provider,
                requestId: input.requestId,
                sourceName: input.sourceName,
                status: source.source.status,
              } satisfies CliQueryExecutionWorkflowResult,
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
              kind: "queryable_source_loaded" as const,
            },
          };
        },
      });

      if (sourceLookup.result.kind !== "queryable_source_loaded") {
        return sourceLookup.result;
      }

      const validation = await dispatchStoredQueryActionEffect<
        "validate_query",
        CliValidateQueryEffectResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: sourceLookup.decision,
        db: input.db,
        expectedEffectType: "validate_query",
        organizationId: input.org.id,
        requestId: input.requestId,
        run: async (effect) => {
          const databaseType = getCliQueryableDatabaseProviderType(
            effect.source.provider,
            effect.source.sourceStatus
          );
          if (!databaseType) {
            throw createQueryAuditProblem(
              `query_action validate_query effect became non-queryable for source "${effect.source.sourceKey}"`
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

      if (validation.result.kind === "query_rejected") {
        return {
          detail: validation.result.detail,
          kind: "query_rejected",
          requestId: input.requestId,
        };
      }
      if (validation.result.kind === "query_preparation_failed") {
        return {
          detail: validation.result.detail,
          hint: validation.result.hint,
          kind: "query_preparation_failed",
          requestId: input.requestId,
        };
      }
      const validationReady = validation.result;

      const credentials = await dispatchStoredQueryActionEffect<
        "load_credentials",
        CliLoadCredentialsEffectResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: validation.decision,
        db: input.db,
        expectedEffectType: "load_credentials",
        organizationId: input.org.id,
        requestId: input.requestId,
        run: async () => {
          const source = requireLoadedSource(loadedSource);
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
              result: credentialsResult,
            };
          }

          return {
            commandPayload: {
              detail: credentialsResult.detail,
              hint: "verify the source configuration and retry",
              kind: "preparation_failed",
              type: "record_credentials_load",
            },
            result: credentialsResult,
          };
        },
      });

      if (credentials.result.kind === "credentials_invalid") {
        return {
          detail: credentials.result.detail,
          hint: "verify the source configuration and retry",
          kind: "query_preparation_failed",
          requestId: input.requestId,
        };
      }

      const execution = await dispatchStoredQueryActionEffect<
        "execute_query",
        CliQueryExecutionResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: credentials.decision,
        db: input.db,
        expectedEffectType: "execute_query",
        organizationId: input.org.id,
        requestId: input.requestId,
        run: async (effect) => {
          const source = requireLoadedSource(loadedSource);
          const loadedQueryCredentials =
            requireLoadedCredentials(loadedCredentials);
          const executionResult = await input.dispatch.executeSql({
            clientTimeoutMs: timeoutMs,
            credentials: loadedQueryCredentials,
            kind: "execute_sql",
            requestId: input.requestId,
            source,
            sql: effect.validatedQuery,
          });

          if (executionResult.kind === "succeeded") {
            successfulResponse = buildCliQuerySuccessResponse({
              elapsedMs: executionResult.elapsedMs,
              rows: executionResult.rows,
              source,
              truncated: validationReady.truncated,
            });

            return {
              commandPayload: {
                elapsedMs: successfulResponse.elapsedMs,
                kind: "succeeded",
                rowCount: successfulResponse.rowCount,
                type: "record_query_execution",
              },
              result: executionResult,
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
                result: executionResult,
              };
            case "query_timed_out":
              return {
                commandPayload: {
                  detail: executionResult.detail,
                  kind: "timed_out",
                  type: "record_query_execution",
                },
                result: executionResult,
              };
            case "query_execution_failed":
              return {
                commandPayload: {
                  detail: executionResult.detail,
                  kind: "failed",
                  type: "record_query_execution",
                },
                result: executionResult,
              };
          }
        },
      });

      if (execution.result.kind !== "succeeded") {
        switch (execution.result.kind) {
          case "query_unavailable":
            return {
              detail: execution.result.detail,
              kind: "query_unavailable",
              requestId: input.requestId,
              retryable: true,
            };
          case "query_timed_out":
            return {
              detail: execution.result.detail,
              kind: "query_timed_out",
              requestId: input.requestId,
              retryable: true,
            };
          case "query_execution_failed":
            return {
              detail: execution.result.detail,
              kind: "query_execution_failed",
              requestId: input.requestId,
              retryable: false,
            };
        }
      }

      const usagePersistence = await dispatchStoredQueryActionEffect<
        "persist_usage",
        CliPersistUsageEffectResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: execution.decision,
        db: input.db,
        expectedEffectType: "persist_usage",
        organizationId: input.org.id,
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

      return {
        kind: "response_ready",
        response: requireSuccessfulResponse(successfulResponse),
        usagePersistence: usagePersistence.result,
      };
    },
    catch: (error) =>
      error instanceof CliConnectProblem
        ? error
        : createQueryAuditProblem(
            `query_action execution failed for source "${input.sourceName}"`,
            error
          ),
  });
}

export async function runCliQueryValidationWorkflowResult(
  input: QueryWorkflowRuntimeBaseInput & {
    dispatch: CliQueryValidationDispatch;
  }
): Promise<CliServiceResult<CliQueryValidationWorkflowResult>> {
  return Result.tryPromise({
    try: async (): Promise<CliQueryValidationWorkflowResult> => {
      const timeoutMs = input.timeoutMs ?? null;
      let loadedSource: CliQuerySourceRecord | null = null;

      const startDecision = await storeAcceptedQueryActionCommand({
        actionId: null,
        actorSnapshot: input.actorSnapshot,
        causedByEventId: null,
        commandInvocationId: `query_action:${input.requestId}:start_validate`,
        commandPayload: {
          queryText: input.sql,
          sourceKey: input.sourceName,
          type: "start_validate",
        },
        db: input.db,
        organizationId: input.org.id,
        requestId: input.requestId,
        surface: "cli",
      });

      const sourceLookup = await dispatchStoredQueryActionEffect<
        "load_source",
        QueryValidationSourceLookupResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: startDecision,
        db: input.db,
        expectedEffectType: "load_source",
        organizationId: input.org.id,
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
              } satisfies CliQueryValidationWorkflowResult,
            };
          }

          const databaseType = getCliQueryableDatabaseProviderType(
            source.source.provider,
            source.source.status
          );
          if (!databaseType) {
            return {
              commandPayload: {
                kind: "not_queryable",
                provider: source.source.provider,
                sourceStatus: source.source.status,
                type: "record_source_lookup",
              },
              result: {
                kind: "source_not_queryable",
                provider: source.source.provider,
                requestId: input.requestId,
                sourceName: input.sourceName,
                status: source.source.status,
              } satisfies CliQueryValidationWorkflowResult,
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
              kind: "queryable_source_loaded" as const,
            },
          };
        },
      });

      if (sourceLookup.result.kind !== "queryable_source_loaded") {
        return sourceLookup.result;
      }

      const validation = await dispatchStoredQueryActionEffect<
        "validate_query",
        CliValidateQueryEffectResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: sourceLookup.decision,
        db: input.db,
        expectedEffectType: "validate_query",
        organizationId: input.org.id,
        requestId: input.requestId,
        run: async (effect) => {
          const databaseType = getCliQueryableDatabaseProviderType(
            effect.source.provider,
            effect.source.sourceStatus
          );
          if (!databaseType) {
            throw createQueryAuditProblem(
              `query_action validate_query effect became non-queryable for source "${effect.source.sourceKey}"`
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

      if (validation.result.kind === "query_rejected") {
        return {
          detail: validation.result.detail,
          kind: "query_rejected",
          requestId: input.requestId,
        };
      }
      if (validation.result.kind === "query_preparation_failed") {
        return {
          detail: validation.result.detail,
          hint: validation.result.hint,
          kind: "query_preparation_failed",
          requestId: input.requestId,
        };
      }

      return {
        kind: "ready",
        normalizedSql: validation.result.normalizedSql,
        requestId: input.requestId,
        source: requireLoadedSource(loadedSource),
        sourceName: input.sourceName,
        timeoutMs,
        truncated: validation.result.truncated,
      };
    },
    catch: (error) =>
      error instanceof CliConnectProblem
        ? error
        : createQueryAuditProblem(
            `query_action validation failed for source "${input.sourceName}"`,
            error
          ),
  });
}

async function dispatchStoredQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedQueryActionDecision;
  db: Database;
  expectedEffectType: EffectType;
  organizationId: string;
  requestId: string;
  run: (effect: Extract<QueryActionEffect, { type: EffectType }>) => Promise<{
    commandPayload: QueryActionCommandPayload;
    result: TResult;
  }>;
}): Promise<{
  decision: StoredAcceptedQueryActionDecision;
  effect: Extract<QueryActionEffect, { type: EffectType }>;
  result: TResult;
}> {
  // Comment: query requests still run synchronously on the request path, so
  // they lease and dispatch the already-committed outbox row inline here until
  // the shared background dispatcher lands.
  const originEvent = requireLastCommittedEvent(input.currentDecision);
  const effectDispatch = await loadRequiredQueryActionEffect({
    actionId: input.currentDecision.actionId,
    db: input.db,
    expectedEffectType: input.expectedEffectType,
    originEventId: originEvent.id,
  });

  await leaseQueryActionEffect({
    db: input.db,
    effectDispatch,
  });

  try {
    const outcome = await input.run(effectDispatch.effect);
    const decision = await storeAcceptedQueryActionCommand({
      actionId: input.currentDecision.actionId,
      actorSnapshot: input.actorSnapshot,
      causedByEventId: effectDispatch.originEventId,
      commandInvocationId: `${effectDispatch.effectKey}:result`,
      commandPayload: outcome.commandPayload,
      db: input.db,
      organizationId: input.organizationId,
      requestId: input.requestId,
      surface: "system",
    });

    await completeQueryActionEffect({
      db: input.db,
      effectId: effectDispatch.id,
    });

    return {
      decision,
      effect: effectDispatch.effect,
      result: outcome.result,
    };
  } catch (error) {
    await releaseQueryActionEffect({
      db: input.db,
      effectId: effectDispatch.id,
      error,
    });
    throw error;
  }
}

async function storeAcceptedQueryActionCommand(
  input: Omit<QueryActionCommand, "family" | "observedAt"> & {
    db: Database;
  }
): Promise<StoredAcceptedQueryActionDecision> {
  const stored = await storeQueryActionCommand({
    command: {
      ...input,
      family: "query_action",
      observedAt: new Date(),
    },
    db: input.db,
  });

  if (stored.isErr()) {
    throw createQueryAuditProblem(
      `query_action ${input.commandPayload.type} could not be stored`,
      stored.error
    );
  }

  if (stored.value.kind !== "accepted") {
    throw createQueryAuditProblem(
      `query_action ${input.commandPayload.type} was rejected with ${stored.value.rejectCode}`
    );
  }

  return stored.value;
}

async function loadRequiredQueryActionEffect<
  EffectType extends QueryActionEffect["type"],
>(input: {
  actionId: string;
  db: Database;
  expectedEffectType: EffectType;
  originEventId: string;
}): Promise<{
  attemptCount: number;
  effect: Extract<QueryActionEffect, { type: EffectType }>;
  effectKey: string;
  id: string;
  originEventId: string;
}> {
  const [row] = await input.db
    .select()
    .from(workflowEffectDispatches)
    .where(
      and(
        eq(workflowEffectDispatches.actionId, input.actionId),
        eq(workflowEffectDispatches.family, "query_action"),
        eq(workflowEffectDispatches.originEventId, input.originEventId),
        eq(workflowEffectDispatches.status, "pending")
      )
    )
    .orderBy(
      asc(workflowEffectDispatches.createdAt),
      asc(workflowEffectDispatches.id)
    )
    .limit(1);

  if (!row) {
    throw createQueryAuditProblem(
      `query_action effect ${input.expectedEffectType} is missing for origin event ${input.originEventId}`
    );
  }

  const parsedEffect = QueryActionEffectSchema.safeParse({
    type: row.effectType,
    ...row.payloadJson,
  });
  if (!parsedEffect.success) {
    throw createQueryAuditProblem(
      `query_action effect ${row.effectType} payload is corrupt`,
      parsedEffect.error
    );
  }

  if (parsedEffect.data.type !== input.expectedEffectType) {
    throw createQueryAuditProblem(
      `query_action expected effect ${input.expectedEffectType} but loaded ${parsedEffect.data.type}`
    );
  }

  return {
    attemptCount: row.attemptCount,
    effect: parsedEffect.data as Extract<
      QueryActionEffect,
      { type: EffectType }
    >,
    effectKey: row.effectKey,
    id: row.id,
    originEventId: row.originEventId,
  };
}

async function leaseQueryActionEffect(input: {
  db: Database;
  effectDispatch: Pick<LoadedQueryActionEffect, "attemptCount" | "id">;
}) {
  const leasedUntil = new Date(Date.now() + EFFECT_LEASE_DURATION_MS);
  const leased = await input.db
    .update(workflowEffectDispatches)
    .set({
      attemptCount: input.effectDispatch.attemptCount + 1,
      lastErrorCode: null,
      lastErrorDetail: null,
      leasedUntil,
      status: "leased",
    })
    .where(
      and(
        eq(workflowEffectDispatches.id, input.effectDispatch.id),
        eq(workflowEffectDispatches.status, "pending")
      )
    )
    .returning({ id: workflowEffectDispatches.id });

  if (leased.length !== 1) {
    throw createQueryAuditProblem(
      `query_action effect ${input.effectDispatch.id} could not be leased`
    );
  }
}

async function completeQueryActionEffect(input: {
  db: Database;
  effectId: string;
}) {
  const completedAt = new Date();
  const completed = await input.db
    .update(workflowEffectDispatches)
    .set({
      completedAt,
      lastErrorCode: null,
      lastErrorDetail: null,
      leasedUntil: null,
      status: "completed",
    })
    .where(eq(workflowEffectDispatches.id, input.effectId))
    .returning({ id: workflowEffectDispatches.id });

  if (completed.length !== 1) {
    throw createQueryAuditProblem(
      `query_action effect ${input.effectId} could not be completed`
    );
  }
}

async function releaseQueryActionEffect(input: {
  db: Database;
  effectId: string;
  error: unknown;
}) {
  await input.db
    .update(workflowEffectDispatches)
    .set({
      availableAt: new Date(),
      lastErrorCode: "dispatch_failed",
      lastErrorDetail: toCliErrorMessage(input.error),
      leasedUntil: null,
      status: "pending",
    })
    .where(eq(workflowEffectDispatches.id, input.effectId));
}

function requireLastCommittedEvent(
  decision: StoredAcceptedQueryActionDecision
) {
  const event = decision.events.at(-1);
  if (!event) {
    throw createQueryAuditProblem(
      `query_action ${decision.commandId} committed without events`
    );
  }

  return event;
}

function requireLoadedSource(
  source: CliQuerySourceRecord | null
): CliQuerySourceRecord {
  if (source === null) {
    throw createQueryAuditProblem(
      "query_action source cache was missing during effect dispatch"
    );
  }

  return source;
}

function requireLoadedCredentials(
  credentials: DatabaseCredentials | null
): DatabaseCredentials {
  if (credentials === null) {
    throw createQueryAuditProblem(
      "query_action credentials cache was missing during execute_query"
    );
  }

  return credentials;
}

function requireSuccessfulResponse(
  response:
    | Extract<
        CliQueryExecutionWorkflowResult,
        { kind: "response_ready" }
      >["response"]
    | null
) {
  if (response === null) {
    throw createQueryAuditProblem(
      "query_action execution response was missing before usage persistence"
    );
  }

  return response;
}

function toQueryActionSourceDescriptor(
  source: CliQuerySourceRecord
): QueryActionSourceDescriptor {
  return {
    displayName: source.displayName,
    name: source.name,
    organizationId: source.organizationId,
    provider: source.provider,
    sourceId: source.id,
    sourceKey: source.sourceKey,
    sourceStatus: source.status,
  };
}

function createQueryAuditProblem(detail: string, cause?: unknown) {
  return createCliServiceProblem({
    ...(cause === undefined ? {} : { cause }),
    detail,
    key: "QUERY_PREPARATION_FAILED",
  });
}
