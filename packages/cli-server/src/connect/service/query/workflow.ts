import {
  DATA_SOURCE_STATUS,
  PROVIDER_TYPES,
  and,
  asc,
  eq,
  queryActionEvents,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { Database, DatabaseCredentials } from "@onequery/db/server";
import { Result } from "better-result";
import { z } from "zod";

import {
  QueryActionEffectSchema,
  QueryActionEventSchema,
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
  CliPersistUsageEffectResult,
  CliValidateQueryEffectResult,
} from "../../../domain/effects";
import type {
  AccessibleCliOrg,
  CliQuerySuccessResult,
  CliQuerySourceRecord,
  CliSourceRecord,
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
  status: "completed" | "leased" | "pending";
};

type QueryableSourceLoadedResult = {
  kind: "queryable_source_loaded";
};

type QueryCredentialsLoadResult =
  | {
      kind: "loaded";
    }
  | {
      detail: string;
      kind: "credentials_invalid";
    };

type QueryExecutionEffectResult =
  | {
      kind: "succeeded";
      response: CliQuerySuccessResult;
    }
  | {
      detail: string;
      kind: "query_unavailable";
      retryable: true;
    }
  | {
      detail: string;
      kind: "query_timed_out";
      retryable: true;
    }
  | {
      detail: string;
      kind: "query_execution_failed";
      retryable: false;
    };

type StoredAcceptedQueryActionResultCommand = {
  commandPayload: { type: string } & Record<string, unknown>;
  decision: StoredAcceptedQueryActionDecision;
};

type QueryExecutionSourceLookupResult =
  | QueryableSourceLoadedResult
  | Extract<CliQueryExecutionWorkflowResult, { kind: "source_not_found" }>
  | Extract<CliQueryExecutionWorkflowResult, { kind: "source_not_queryable" }>;

type QueryValidationSourceLookupResult =
  | QueryableSourceLoadedResult
  | Extract<CliQueryValidationWorkflowResult, { kind: "source_not_found" }>
  | Extract<CliQueryValidationWorkflowResult, { kind: "source_not_queryable" }>;

const CliQuerySuccessResultSchema = z
  .object({
    columns: z.array(
      z
        .object({
          logicalType: z
            .enum([
              "string",
              "number",
              "boolean",
              "bigint",
              "datetime",
              "array",
              "json",
            ])
            .nullable(),
          name: z.string(),
        })
        .strict()
    ),
    elapsedMs: z.number().int(),
    rowCount: z.number().int(),
    rows: z.array(z.array(z.string())),
    source: z
      .object({
        displayName: z.string().nullable(),
        id: z.string(),
        provider: z.enum(PROVIDER_TYPES),
        sourceKey: z.string(),
        status: z.enum(DATA_SOURCE_STATUS),
      })
      .strict(),
    truncated: z.boolean(),
  })
  .strict();

const StoredQueryValidationResultPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("accepted"),
      truncated: z.boolean(),
      type: z.literal("record_query_validation"),
      validatedQuery: z.string(),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string().optional(),
      kind: z.literal("rejected"),
      type: z.literal("record_query_validation"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string(),
      kind: z.literal("preparation_failed"),
      type: z.literal("record_query_validation"),
    })
    .strict(),
]);

const StoredQueryExecutionResultPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      elapsedMs: z.number().int(),
      kind: z.literal("succeeded"),
      response: CliQuerySuccessResultSchema,
      rowCount: z.number().int(),
      type: z.literal("record_query_execution"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      kind: z.literal("unavailable"),
      type: z.literal("record_query_execution"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      kind: z.literal("timed_out"),
      type: z.literal("record_query_execution"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      kind: z.literal("failed"),
      type: z.literal("record_query_execution"),
    })
    .strict(),
]);

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
        replay: ({ stored }) =>
          toStoredQueryValidationResult(stored.commandPayload),
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
        QueryCredentialsLoadResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: validation.decision,
        db: input.db,
        expectedEffectType: "load_credentials",
        organizationId: input.org.id,
        replay: ({ stored }) =>
          toStoredQueryCredentialsLoadResult(stored.decision),
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
                kind: "loaded" as const,
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
              kind: "credentials_invalid" as const,
            },
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
        QueryExecutionEffectResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: credentials.decision,
        db: input.db,
        expectedEffectType: "execute_query",
        organizationId: input.org.id,
        replay: ({ stored }) =>
          toStoredQueryExecutionResult(stored.commandPayload),
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
            clientTimeoutMs: timeoutMs,
            credentials: queryCredentials,
            kind: "execute_sql",
            requestId: input.requestId,
            source,
            sql: effect.validatedQuery,
          });

          if (executionResult.kind === "succeeded") {
            const response = buildCliQuerySuccessResponse({
              elapsedMs: executionResult.elapsedMs,
              rows: executionResult.rows,
              source: toCliSourceRecord(effect.source),
              truncated: validationReady.truncated,
            });

            return {
              commandPayload: {
                elapsedMs: response.elapsedMs,
                kind: "succeeded",
                response,
                rowCount: response.rowCount,
                type: "record_query_execution",
              },
              result: {
                kind: "succeeded" as const,
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
                  kind: "query_unavailable" as const,
                  retryable: true as const,
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
                  kind: "query_timed_out" as const,
                  retryable: true as const,
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
                  kind: "query_execution_failed" as const,
                  retryable: false as const,
                },
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

      return {
        kind: "response_ready",
        response: execution.result.response,
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
        replay: ({ stored }) =>
          toStoredQueryValidationResult(stored.commandPayload),
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
        source: toCliSourceRecord(validation.effect.source),
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
  replay: (input: {
    effect: Extract<QueryActionEffect, { type: EffectType }>;
    stored: StoredAcceptedQueryActionResultCommand;
  }) => Promise<TResult> | TResult;
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

  const stored = await loadStoredAcceptedQueryActionResultCommand({
    commandInvocationId: `${effectDispatch.effectKey}:result`,
    db: input.db,
  });
  if (stored !== null) {
    return {
      decision: stored.decision,
      effect: effectDispatch.effect,
      result: await input.replay({
        effect: effectDispatch.effect,
        stored,
      }),
    };
  }

  if (effectDispatch.status !== "pending") {
    throw createQueryAuditProblem(
      `query_action effect ${effectDispatch.id} is ${effectDispatch.status} without a stored result command`
    );
  }

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
  status: "completed" | "leased" | "pending";
}> {
  const [row] = await input.db
    .select()
    .from(workflowEffectDispatches)
    .where(
      and(
        eq(workflowEffectDispatches.actionId, input.actionId),
        eq(workflowEffectDispatches.family, "query_action"),
        eq(workflowEffectDispatches.originEventId, input.originEventId)
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
    status: row.status,
  };
}

async function loadStoredAcceptedQueryActionResultCommand(input: {
  commandInvocationId: string;
  db: Database;
}): Promise<StoredAcceptedQueryActionResultCommand | null> {
  const storedCommand = await input.db.query.workflowCommands.findFirst({
    where: and(
      eq(workflowCommands.family, "query_action"),
      eq(workflowCommands.commandInvocationId, input.commandInvocationId)
    ),
  });

  if (storedCommand === undefined) {
    return null;
  }

  if (storedCommand.decisionKind !== "accepted") {
    throw createQueryAuditProblem(
      `query_action stored result command ${input.commandInvocationId} was unexpectedly rejected`
    );
  }

  if (storedCommand.actionId === null) {
    throw createQueryAuditProblem(
      `query_action stored result command ${input.commandInvocationId} is missing its action id`
    );
  }

  const events = await input.db
    .select()
    .from(queryActionEvents)
    .where(eq(queryActionEvents.commandId, storedCommand.id))
    .orderBy(asc(queryActionEvents.sequence));

  return {
    commandPayload: {
      type: storedCommand.commandType,
      ...storedCommand.commandPayloadJson,
    },
    decision: {
      actionId: storedCommand.actionId,
      commandId: storedCommand.id,
      events: events.map((row) => {
        const parsed = QueryActionEventSchema.safeParse({
          type: row.eventType,
          ...row.payloadJson,
        });
        if (!parsed.success) {
          throw createQueryAuditProblem(
            `query_action stored result command ${input.commandInvocationId} has a corrupt ${row.eventType} event payload`,
            parsed.error
          );
        }

        return {
          ...parsed.data,
          id: row.id,
          occurredAt: row.occurredAt,
          sequence: row.sequence,
        };
      }),
      family: "query_action",
      idempotency: "replayed" as const,
      kind: "accepted" as const,
    },
  };
}

function toStoredQuerySourceLookupResult(input: {
  decision: StoredAcceptedQueryActionDecision;
  orgSlug: string;
  requestId: string;
  sourceName: string;
}): QueryExecutionSourceLookupResult | QueryValidationSourceLookupResult {
  const event = requireLastCommittedEvent(input.decision);

  switch (event.type) {
    case "source_loaded":
      return {
        kind: "queryable_source_loaded",
      };
    case "source_not_found":
      return {
        kind: "source_not_found",
        orgSlug: input.orgSlug,
        requestId: input.requestId,
        sourceName: input.sourceName,
      };
    case "source_not_queryable":
      return {
        kind: "source_not_queryable",
        provider: event.provider,
        requestId: input.requestId,
        sourceName: input.sourceName,
        status: event.sourceStatus,
      };
    default:
      throw createQueryAuditProblem(
        `query_action replay expected a source lookup event but loaded ${event.type}`
      );
  }
}

function toStoredQueryValidationResult(
  commandPayload: StoredAcceptedQueryActionResultCommand["commandPayload"]
): CliValidateQueryEffectResult {
  const parsed =
    StoredQueryValidationResultPayloadSchema.safeParse(commandPayload);
  if (!parsed.success) {
    throw createQueryAuditProblem(
      "query_action stored validation result payload is corrupt",
      parsed.error
    );
  }

  switch (parsed.data.kind) {
    case "accepted":
      return {
        kind: "query_ready",
        normalizedSql: parsed.data.validatedQuery,
        truncated: parsed.data.truncated,
      };
    case "rejected":
      return {
        detail: parsed.data.detail,
        kind: "query_rejected",
      };
    case "preparation_failed":
      return {
        detail: parsed.data.detail,
        hint: parsed.data.hint,
        kind: "query_preparation_failed",
      };
  }
}

function toStoredQueryCredentialsLoadResult(
  decision: StoredAcceptedQueryActionDecision
): QueryCredentialsLoadResult {
  const event = requireLastCommittedEvent(decision);

  switch (event.type) {
    case "credentials_loaded":
      return {
        kind: "loaded",
      };
    case "query_preparation_failed":
      return {
        detail: event.detail,
        kind: "credentials_invalid",
      };
    default:
      throw createQueryAuditProblem(
        `query_action replay expected a credentials load event but loaded ${event.type}`
      );
  }
}

function toStoredQueryExecutionResult(
  commandPayload: StoredAcceptedQueryActionResultCommand["commandPayload"]
): QueryExecutionEffectResult {
  const parsed =
    StoredQueryExecutionResultPayloadSchema.safeParse(commandPayload);
  if (!parsed.success) {
    throw createQueryAuditProblem(
      "query_action stored execution result payload is corrupt",
      parsed.error
    );
  }

  switch (parsed.data.kind) {
    case "succeeded":
      return {
        kind: "succeeded",
        response: parsed.data.response,
      };
    case "unavailable":
      return {
        detail: parsed.data.detail,
        kind: "query_unavailable",
        retryable: true,
      };
    case "timed_out":
      return {
        detail: parsed.data.detail,
        kind: "query_timed_out",
        retryable: true,
      };
    case "failed":
      return {
        detail: parsed.data.detail,
        kind: "query_execution_failed",
        retryable: false,
      };
  }
}

function toStoredUsagePersistenceResult(input: {
  decision: StoredAcceptedQueryActionDecision;
  sourceId: string;
}): CliPersistUsageEffectResult {
  const event = requireLastCommittedEvent(input.decision);

  switch (event.type) {
    case "usage_persisted":
      return {
        kind: "usage_persisted",
      };
    case "usage_persist_failed":
      return {
        detail: event.detail,
        kind: "usage_persist_failed",
        sourceId: input.sourceId,
      };
    default:
      throw createQueryAuditProblem(
        `query_action replay expected a usage persistence event but loaded ${event.type}`
      );
  }
}

async function loadRequiredCliQuerySourceRecord(input: {
  cachedSource: CliQuerySourceRecord | null;
  dispatch: Pick<CliQueryExecutionDispatch, "loadSource">;
  sourceDescriptor: QueryActionSourceDescriptor;
}): Promise<CliQuerySourceRecord> {
  if (input.cachedSource !== null) {
    return input.cachedSource;
  }

  const loaded = await input.dispatch.loadSource({
    kind: "load_source",
    organizationId: input.sourceDescriptor.organizationId,
    sourceKey: input.sourceDescriptor.sourceKey,
  });

  if (loaded.kind !== "found") {
    throw createQueryAuditProblem(
      `query_action replay could not reload source "${input.sourceDescriptor.sourceKey}" for a downstream effect`
    );
  }

  if (
    loaded.source.id !== input.sourceDescriptor.sourceId ||
    loaded.source.organizationId !== input.sourceDescriptor.organizationId ||
    loaded.source.provider !== input.sourceDescriptor.provider ||
    loaded.source.sourceKey !== input.sourceDescriptor.sourceKey
  ) {
    throw createQueryAuditProblem(
      `query_action replay reloaded source "${input.sourceDescriptor.sourceKey}" with a mismatched identity`
    );
  }

  return loaded.source;
}

async function loadRequiredCliQueryCredentials(input: {
  cachedCredentials: DatabaseCredentials | null;
  dispatch: Pick<CliQueryExecutionDispatch, "loadCredentials">;
  source: CliQuerySourceRecord;
}): Promise<DatabaseCredentials> {
  if (input.cachedCredentials !== null) {
    return input.cachedCredentials;
  }

  const loaded = await input.dispatch.loadCredentials({
    kind: "load_credentials",
    source: input.source,
  });

  if (loaded.kind !== "credentials_loaded") {
    throw createQueryAuditProblem(
      `query_action replay could not reload credentials for source "${input.source.sourceKey}"`
    );
  }

  return loaded.credentials;
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

function toCliSourceRecord(
  source: QueryActionSourceDescriptor
): CliSourceRecord {
  return {
    displayName: source.displayName,
    id: source.sourceId,
    provider: source.provider,
    sourceKey: source.sourceKey,
    status: source.sourceStatus,
  };
}

function createQueryAuditProblem(detail: string, cause?: unknown) {
  return createCliServiceProblem({
    ...(cause === undefined ? {} : { cause }),
    detail,
    key: "QUERY_PREPARATION_FAILED",
  });
}
