import { Buffer } from "node:buffer";

import {
  PROVIDER_TYPES,
  and,
  asc,
  eq,
  sourceApiActionEvents,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import type {
  PreparedSourceApi,
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiContinuationTokenPayload,
  SourceApiDescriptor,
  SourceApiDraft,
  SourceApiExecutionResult,
  SourceApiPreview,
} from "@onequery/server/source-api";
import { Result } from "better-result";
import { z } from "zod";

import {
  SourceApiActionEffectSchema,
  SourceApiActionEventSchema,
  storeSourceApiActionCommand,
} from "../../../audit";
import type {
  SourceApiActionCommand,
  SourceApiActionCommandPayload,
  SourceApiActionEffect,
  SourceApiActionEvent,
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
  StoredSourceApiExecutionResult,
  StoredWorkflowDecision,
  WorkflowActorSnapshot,
} from "../../../audit";
import type { CliQuerySourceRecord } from "../../../domain/workflows";
import { toCliErrorMessage } from "../../../observability";
import { createCliConnectSourceNotFoundProblem } from "../errors";
import { createCliServiceProblem } from "../result";
import type { CliServiceResult } from "../result";
import type { CliHonoContext } from "../types";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  assertPreparedSourceApiStillValid,
  createSourceApiConnectProblem,
  executePreparedSourceApiResult,
  prepareSourceApiDraftResult,
  resolveSourceApiDescriptor,
} from "./runtime";

const EFFECT_LEASE_DURATION_MS = 30_000;

type SourceApiWorkflowContext = {
  actor: SourceApiActorContext;
  actorSnapshot: WorkflowActorSnapshot;
  c: CliHonoContext;
  organizationId: string;
  orgSlug: string;
  requestId: string;
};

type SourceApiExecuteSuccess = {
  continuationToken?: string;
  preview: SourceApiPreview;
  result?: SourceApiExecutionResult;
};

type StoredAcceptedSourceApiActionDecision = Extract<
  StoredWorkflowDecision<"source_api_action", SourceApiActionEvent, string>,
  { kind: "accepted" }
>;

type LoadedSourceApiActionEffect = {
  attemptCount: number;
  effect: SourceApiActionEffect;
  effectKey: string;
  id: string;
  originEventId: string;
  status: "completed" | "leased" | "pending";
};

type DescriptorResolutionResult =
  | {
      descriptor: SourceApiDescriptor;
      kind: "resolved";
    }
  | {
      kind: "failed";
      problem: ReturnType<typeof createCliServiceProblem>;
    };

type RequestPreparationResult =
  | {
      kind: "prepared";
    }
  | {
      kind: "failed";
      problem: ReturnType<typeof createCliServiceProblem>;
    };

type StoredAcceptedSourceApiActionResultCommand = {
  commandPayload: { type: string } & Record<string, unknown>;
  decision: StoredAcceptedSourceApiActionDecision;
};

type PageFetchResult =
  | {
      kind: "succeeded";
      result: SourceApiExecutionResult;
    }
  | {
      kind: "failed";
      problem: ReturnType<typeof createCliServiceProblem>;
    };

type LoadedPreparedSourceResult =
  | {
      kind: "loaded";
      source: PreparedSourceConnection;
    }
  | {
      detail: string;
      kind: "not_found";
    }
  | {
      detail: string;
      kind: "unavailable";
    };

const JsonValueSchema: z.ZodType<import("@bufbuild/protobuf").JsonValue> =
  z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(JsonValueSchema),
      z.record(z.string(), JsonValueSchema),
    ])
  );

const SourceApiSourceSchema = z
  .object({
    displayName: z.string().nullable().optional(),
    provider: z.enum(PROVIDER_TYPES),
    sourceKey: z.string(),
  })
  .strict();

const SourceApiHeaderSchema = z
  .object({
    name: z.string(),
    value: z.string(),
  })
  .strict();

const SourceApiExampleSchema = z
  .object({
    command: z.string(),
    description: z.string().optional(),
    label: z.string(),
  })
  .strict();

const SourceApiOperationSchema = z
  .object({
    description: z.string(),
    examples: z.array(SourceApiExampleSchema),
    fieldPolicy: z
      .object({
        acceptsInput: z.boolean(),
        allowsRawFields: z.boolean(),
        allowsTypedFields: z.boolean(),
        inputMode: z.enum(["none", "request_object", "request_body"]),
        mergePatches: z.boolean(),
        supportsArrayPaths: z.boolean(),
        supportsNestedPaths: z.boolean(),
      })
      .strict(),
    headerPolicy: z
      .object({
        allowedRequestHeaders: z.array(z.string()),
        allowedResponseHeaders: z.array(z.string()),
      })
      .strict(),
    kind: z.enum(["http_request", "structured_request"]),
    methodPolicy: z
      .object({
        allowedMethods: z.array(z.string()),
        defaultMethod: z.string().optional(),
      })
      .strict(),
    name: z.string(),
    notes: z.array(z.string()),
    paginationPolicy: z.enum(["none", "continuation_token"]),
    selectorKind: z.enum(["none", "path", "identifier"]),
    selectorLabel: z.string().optional(),
    summary: z.string(),
  })
  .strict();

const SourceApiDescriptorSchema = z
  .object({
    defaultPathOperation: z.string().optional(),
    descriptorVersion: z.string(),
    examples: z.array(SourceApiExampleSchema),
    notes: z.array(z.string()),
    operations: z.array(SourceApiOperationSchema),
    source: SourceApiSourceSchema,
  })
  .strict();

const StoredSourceApiResponseBodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("none"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json"),
      value: JsonValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      value: z.string(),
    })
    .strict(),
  z
    .object({
      base64: z.string(),
      kind: z.literal("binary"),
    })
    .strict(),
]);

const StoredSourceApiExecutionResultSchema = z
  .object({
    body: StoredSourceApiResponseBodySchema,
    contentType: z.string(),
    headers: z.array(SourceApiHeaderSchema),
    nextContinuationState: JsonValueSchema.optional(),
    operation: z.string(),
    selector: z.string().optional(),
    source: SourceApiSourceSchema,
    status: z.number().int(),
  })
  .strict();

const StoredDescriptorResolutionResultPayloadSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        descriptor: SourceApiDescriptorSchema,
        kind: z.literal("resolved"),
        requestDescriptor: z.unknown().nullable(),
        type: z.literal("record_descriptor_resolution"),
      })
      .strict(),
    z
      .object({
        detail: z.string(),
        failureCode: z.enum(["descriptor_unavailable", "permission_denied"]),
        kind: z.literal("failed"),
        type: z.literal("record_descriptor_resolution"),
      })
      .strict(),
  ]
);

const StoredPageFetchResultPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      attemptNumber: z.number().int(),
      contentType: z.string().nullable(),
      executionResult: StoredSourceApiExecutionResultSchema,
      hasContinuation: z.boolean(),
      httpStatus: z.number().int(),
      kind: z.literal("succeeded"),
      pageIndex: z.number().int(),
      responseBytes: z.number().int().nullable(),
      type: z.literal("record_page_fetch"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      detail: z.string(),
      kind: z.literal("retryable_failure"),
      pageIndex: z.number().int(),
      type: z.literal("record_page_fetch"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      detail: z.string(),
      failureCode: z.enum([
        "request_failed",
        "request_timed_out",
        "execution_failed",
        "execution_state_invalid",
      ]),
      kind: z.literal("terminal_failure"),
      pageIndex: z.number().int(),
      type: z.literal("record_page_fetch"),
    })
    .strict(),
]);

export async function runDescribeSourceApiWorkflowResult(
  input: SourceApiWorkflowContext & {
    dependencies: SourceApiServiceDependencies;
    sourceKey: string;
  }
): Promise<CliServiceResult<SourceApiDescriptor>> {
  return Result.tryPromise({
    try: async () => {
      let resolvedDescriptor: SourceApiDescriptor | null = null;

      const startDecision = await storeAcceptedSourceApiActionCommand({
        actionId: null,
        actorSnapshot: input.actorSnapshot,
        causedByEventId: null,
        commandInvocationId: `source_api_action:${input.requestId}:start_describe`,
        commandPayload: {
          sourceKey: input.sourceKey,
          type: "start_describe",
        },
        db: input.c.var.storage.db,
        organizationId: input.organizationId,
        requestId: input.requestId,
        surface: "cli",
      });

      const sourceLookup = await dispatchStoredSourceApiActionEffect<
        "load_source",
        { kind: "found" } | { kind: "not_found" }
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: startDecision,
        db: input.c.var.storage.db,
        expectedEffectType: "load_source",
        organizationId: input.organizationId,
        replay: ({ stored }) => toStoredSourceLookupResult(stored.decision),
        requestId: input.requestId,
        run: async (effect) => {
          const source = await input.dependencies.runCliLoadSourceEffect({
            db: input.c.var.storage.db,
            effect: {
              kind: "load_source",
              organizationId: effect.organizationId,
              sourceKey: effect.sourceKey,
            },
          });

          if (source.kind === "not_found") {
            return {
              commandPayload: {
                kind: "not_found",
                sourceKey: effect.sourceKey,
                type: "record_source_lookup",
              },
              result: {
                kind: "not_found" as const,
              },
            };
          }

          return {
            commandPayload: {
              kind: "found",
              source: toSourceApiActionSourceDescriptor(source.source),
              type: "record_source_lookup",
            },
            result: {
              kind: "found" as const,
            },
          };
        },
      });

      if (sourceLookup.result.kind === "not_found") {
        throw createCliConnectSourceNotFoundProblem(
          input.orgSlug,
          input.sourceKey
        );
      }

      const descriptorResolution = await dispatchStoredSourceApiActionEffect<
        "resolve_descriptor",
        DescriptorResolutionResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: sourceLookup.decision,
        db: input.c.var.storage.db,
        expectedEffectType: "resolve_descriptor",
        organizationId: input.organizationId,
        replay: ({ stored }) => {
          const result = toStoredDescriptorResolutionResult(
            stored.commandPayload
          );
          if (result.kind === "resolved") {
            resolvedDescriptor = result.descriptor;
          }

          return result;
        },
        requestId: input.requestId,
        run: async (effect) => {
          const loadedSource = await loadPreparedSourceConnection({
            c: input.c,
            dependencies: input.dependencies,
            organizationId: input.organizationId,
            source: effect.source,
          });

          if (loadedSource.kind !== "loaded") {
            const problem = createCliServiceProblem({
              detail: loadedSource.detail,
              key: "SOURCE_API_SOURCE_UNAVAILABLE",
            });
            return {
              commandPayload: {
                detail: problem.message,
                failureCode: "descriptor_unavailable",
                kind: "failed",
                type: "record_descriptor_resolution",
              },
              result: {
                kind: "failed" as const,
                problem,
              },
            };
          }

          const descriptor = await resolveSourceApiDescriptor(
            {
              actor: input.actor,
              source: loadedSource.source,
            },
            input.dependencies
          );

          if (descriptor.isErr()) {
            const failure = toDescriptorResolutionFailure(
              descriptor.error,
              input.dependencies
            );
            return {
              commandPayload: {
                detail: failure.problem.message,
                failureCode: failure.failureCode,
                kind: "failed",
                type: "record_descriptor_resolution",
              },
              result: {
                kind: "failed" as const,
                problem: failure.problem,
              },
            };
          }

          resolvedDescriptor = descriptor.value;
          return {
            commandPayload: {
              descriptor: descriptor.value,
              kind: "resolved",
              requestDescriptor: null,
              type: "record_descriptor_resolution",
            },
            result: {
              descriptor: descriptor.value,
              kind: "resolved" as const,
            },
          };
        },
      });

      if (descriptorResolution.result.kind === "failed") {
        throw descriptorResolution.result.problem;
      }

      const descriptor = resolvedDescriptor;
      if (descriptor === null) {
        throw createSourceApiAuditProblem(
          "source_api_action describe resolved without a descriptor"
        );
      }

      return descriptor;
    },
    catch: (error) => ensureCliServiceProblem(error),
  });
}

export async function runStartSourceApiExecuteWorkflowResult(
  input: SourceApiWorkflowContext & {
    dependencies: SourceApiServiceDependencies;
    draft: SourceApiDraft;
    invokeMode: "execute" | "preview_only";
    sourceKey: string;
  }
): Promise<CliServiceResult<SourceApiExecuteSuccess>> {
  return Result.tryPromise({
    try: async () => {
      let resolvedDescriptor: SourceApiDescriptor | null = null;
      let preparedRequest: PreparedSourceApi | null = null;

      const startDecision = await storeAcceptedSourceApiActionCommand({
        actionId: null,
        actorSnapshot: input.actorSnapshot,
        causedByEventId: null,
        commandInvocationId: `source_api_action:${input.requestId}:start_invoke`,
        commandPayload: {
          invokeMode: input.invokeMode,
          requestDescriptor: buildInitialRequestDescriptor(input.draft),
          sourceKey: input.sourceKey,
          type: "start_invoke",
        },
        db: input.c.var.storage.db,
        organizationId: input.organizationId,
        requestId: input.requestId,
        surface: "cli",
      });

      const sourceLookup = await dispatchStoredSourceApiActionEffect<
        "load_source",
        { kind: "found" } | { kind: "not_found" }
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: startDecision,
        db: input.c.var.storage.db,
        expectedEffectType: "load_source",
        organizationId: input.organizationId,
        replay: ({ stored }) => toStoredSourceLookupResult(stored.decision),
        requestId: input.requestId,
        run: async (effect) => {
          const source = await input.dependencies.runCliLoadSourceEffect({
            db: input.c.var.storage.db,
            effect: {
              kind: "load_source",
              organizationId: effect.organizationId,
              sourceKey: effect.sourceKey,
            },
          });

          if (source.kind === "not_found") {
            return {
              commandPayload: {
                kind: "not_found",
                sourceKey: effect.sourceKey,
                type: "record_source_lookup",
              },
              result: {
                kind: "not_found" as const,
              },
            };
          }

          return {
            commandPayload: {
              kind: "found",
              source: toSourceApiActionSourceDescriptor(source.source),
              type: "record_source_lookup",
            },
            result: {
              kind: "found" as const,
            },
          };
        },
      });

      if (sourceLookup.result.kind === "not_found") {
        throw createCliConnectSourceNotFoundProblem(
          input.orgSlug,
          input.sourceKey
        );
      }

      const descriptorResolution = await dispatchStoredSourceApiActionEffect<
        "resolve_descriptor",
        DescriptorResolutionResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: sourceLookup.decision,
        db: input.c.var.storage.db,
        expectedEffectType: "resolve_descriptor",
        organizationId: input.organizationId,
        replay: ({ stored }) => {
          const result = toStoredDescriptorResolutionResult(
            stored.commandPayload
          );
          if (result.kind === "resolved") {
            resolvedDescriptor = result.descriptor;
          }

          return result;
        },
        requestId: input.requestId,
        run: async (effect) => {
          const loadedSource = await loadPreparedSourceConnection({
            c: input.c,
            dependencies: input.dependencies,
            organizationId: input.organizationId,
            source: effect.source,
          });

          if (loadedSource.kind !== "loaded") {
            const problem = createCliServiceProblem({
              detail: loadedSource.detail,
              key: "SOURCE_API_SOURCE_UNAVAILABLE",
            });
            return {
              commandPayload: {
                detail: problem.message,
                failureCode: "descriptor_unavailable",
                kind: "failed",
                type: "record_descriptor_resolution",
              },
              result: {
                kind: "failed" as const,
                problem,
              },
            };
          }

          const descriptor = await resolveSourceApiDescriptor(
            {
              actor: input.actor,
              source: loadedSource.source,
            },
            input.dependencies
          );

          if (descriptor.isErr()) {
            const failure = toDescriptorResolutionFailure(
              descriptor.error,
              input.dependencies
            );
            return {
              commandPayload: {
                detail: failure.problem.message,
                failureCode: failure.failureCode,
                kind: "failed",
                type: "record_descriptor_resolution",
              },
              result: {
                kind: "failed" as const,
                problem: failure.problem,
              },
            };
          }

          resolvedDescriptor = descriptor.value;
          return {
            commandPayload: {
              descriptor: descriptor.value,
              kind: "resolved",
              requestDescriptor: buildResolvedRequestDescriptor({
                descriptor: descriptor.value,
                draft: input.draft,
              }),
              type: "record_descriptor_resolution",
            },
            result: {
              descriptor: descriptor.value,
              kind: "resolved" as const,
            },
          };
        },
      });

      if (descriptorResolution.result.kind === "failed") {
        throw descriptorResolution.result.problem;
      }

      const preparation = await dispatchStoredSourceApiActionEffect<
        "prepare_request",
        RequestPreparationResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: descriptorResolution.decision,
        db: input.c.var.storage.db,
        expectedEffectType: "prepare_request",
        organizationId: input.organizationId,
        replay: ({ stored }) =>
          toStoredRequestPreparationResult(stored.decision),
        requestId: input.requestId,
        run: async (effect) => {
          const descriptor =
            requireResolvedSourceApiDescriptor(resolvedDescriptor);
          const source = await loadRequiredPreparedSourceConnection({
            c: input.c,
            dependencies: input.dependencies,
            organizationId: input.organizationId,
            source: effect.source,
          });
          const prepared = await prepareSourceApiDraftResult(
            {
              actor: input.actor,
              descriptor,
              draft: input.draft,
              source,
            },
            input.dependencies
          );

          if (prepared.isErr()) {
            const failure = toRequestPreparationFailure(
              prepared.error,
              input.dependencies
            );
            return {
              commandPayload: {
                detail: failure.problem.message,
                failureCode: failure.failureCode,
                kind: "failed",
                type: "record_request_preparation",
              },
              result: {
                kind: "failed" as const,
                problem: failure.problem,
              },
            };
          }

          preparedRequest = prepared.value;
          return {
            commandPayload: {
              kind: "prepared",
              preparedRequestFingerprint: prepared.value.preparedBinding,
              type: "record_request_preparation",
            },
            result: {
              kind: "prepared" as const,
            },
          };
        },
      });

      if (preparation.result.kind === "failed") {
        throw preparation.result.problem;
      }

      const prepared = await loadRequiredPreparedSourceApi({
        actor: input.actor,
        c: input.c,
        dependencies: input.dependencies,
        descriptor: resolvedDescriptor,
        draft: input.draft,
        prepared: preparedRequest,
        source: preparation.effect.source,
      });
      preparedRequest = prepared;
      const preview = input.dependencies.createSourceApiPreview(prepared);

      if (input.invokeMode === "preview_only") {
        return {
          preview,
        };
      }

      const pageFetch = await dispatchStoredSourceApiActionEffect<
        "execute_page",
        PageFetchResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: preparation.decision,
        db: input.c.var.storage.db,
        expectedEffectType: "execute_page",
        organizationId: input.organizationId,
        replay: ({ stored }) => toStoredPageFetchResult(stored.commandPayload),
        requestId: input.requestId,
        run: async (effect) => {
          const source = await loadRequiredPreparedSourceConnection({
            c: input.c,
            dependencies: input.dependencies,
            organizationId: input.organizationId,
            source: effect.source,
          });
          const currentPrepared = await loadRequiredPreparedSourceApi({
            actor: input.actor,
            c: input.c,
            dependencies: input.dependencies,
            descriptor: resolvedDescriptor,
            draft: input.draft,
            prepared: preparedRequest,
            source: effect.source,
          });
          preparedRequest = currentPrepared;
          assertMatchingPreparedRequestFingerprint({
            expectedFingerprint: effect.preparedRequestFingerprint,
            prepared: currentPrepared,
          });

          const executionResult = await executePreparedSourceApiAttempt({
            actor: input.actor,
            attemptNumber: effect.attemptNumber,
            c: input.c,
            dependencies: input.dependencies,
            pageIndex: effect.pageIndex,
            prepared: currentPrepared,
            source,
          });

          if (executionResult.kind === "failed") {
            return {
              commandPayload: executionResult.commandPayload,
              result: {
                kind: "failed" as const,
                problem: executionResult.problem,
              },
            };
          }

          return {
            commandPayload: {
              attemptNumber: effect.attemptNumber,
              contentType: executionResult.result.contentType,
              executionResult: encodeStoredSourceApiExecutionResult(
                executionResult.result
              ),
              hasContinuation:
                executionResult.result.nextContinuationState !== undefined,
              httpStatus: executionResult.result.status,
              kind: "succeeded",
              pageIndex: effect.pageIndex,
              responseBytes: measureSourceApiResponseBytes(
                executionResult.result
              ),
              type: "record_page_fetch",
            },
            result: {
              kind: "succeeded" as const,
              result: executionResult.result,
            },
          };
        },
      });

      if (pageFetch.result.kind === "failed") {
        throw pageFetch.result.problem;
      }

      const lastCommittedEvent = requireLastCommittedEvent(pageFetch.decision);
      return {
        continuationToken: encodeSourceApiContinuationTokenValue(
          {
            actionId: pageFetch.decision.actionId,
            prepared,
            preparedRequestFingerprint: prepared.preparedBinding,
            result: pageFetch.result.result,
            resumeFromEventId: lastCommittedEvent.id,
            secret: input.c.var.runtime.crypto.masterEncryptionKey,
          },
          input.dependencies
        ),
        preview,
        result: pageFetch.result.result,
      };
    },
    catch: (error) => ensureCliServiceProblem(error),
  });
}

export async function runResumeSourceApiExecuteWorkflowResult(
  input: SourceApiWorkflowContext & {
    continuation: SourceApiContinuationTokenPayload;
    dependencies: SourceApiServiceDependencies;
    source: PreparedSourceConnection;
  }
): Promise<CliServiceResult<SourceApiExecuteSuccess>> {
  return Result.tryPromise({
    try: async () => {
      const stored = await storeSourceApiActionCommand({
        command: {
          actionId: input.continuation.actionId,
          actorSnapshot: input.actorSnapshot,
          causedByEventId: null,
          commandInvocationId: `source_api_action:${input.requestId}:resume_invoke`,
          commandPayload: {
            preparedRequestFingerprint:
              input.continuation.preparedRequestFingerprint,
            resumeFromEventId: input.continuation.resumeFromEventId,
            type: "resume_invoke",
          },
          family: "source_api_action",
          observedAt: new Date(),
          organizationId: input.organizationId,
          requestId: input.requestId,
          surface: "cli",
        },
        db: input.c.var.storage.db,
      });

      if (stored.isErr()) {
        throw createSourceApiAuditProblem(
          "source_api_action resume_invoke could not be stored",
          stored.error
        );
      }

      if (stored.value.kind === "rejected") {
        throw createCliServiceProblem({
          detail:
            stored.value.rejectCode === "causation_mismatch"
              ? "Source API continuation token is stale"
              : "Source API continuation token can no longer resume this action",
          key: "SOURCE_API_EXECUTION_STATE_INVALID",
        });
      }

      const resumeDecision = stored.value;
      const preview = input.dependencies.createSourceApiPreview(
        input.continuation.prepared
      );

      const pageFetch = await dispatchStoredSourceApiActionEffect<
        "execute_page",
        PageFetchResult
      >({
        actorSnapshot: input.actorSnapshot,
        currentDecision: resumeDecision,
        db: input.c.var.storage.db,
        expectedEffectType: "execute_page",
        organizationId: input.organizationId,
        replay: ({ stored }) => toStoredPageFetchResult(stored.commandPayload),
        requestId: input.requestId,
        run: async (effect) => {
          assertMatchingPreparedRequestFingerprint({
            expectedFingerprint: effect.preparedRequestFingerprint,
            prepared: input.continuation.prepared,
          });

          const executionResult = await executePreparedSourceApiAttempt({
            actor: input.actor,
            attemptNumber: effect.attemptNumber,
            c: input.c,
            continuationState: input.continuation.state,
            dependencies: input.dependencies,
            pageIndex: effect.pageIndex,
            prepared: input.continuation.prepared,
            source: input.source,
          });

          if (executionResult.kind === "failed") {
            return {
              commandPayload: executionResult.commandPayload,
              result: {
                kind: "failed" as const,
                problem: executionResult.problem,
              },
            };
          }

          return {
            commandPayload: {
              attemptNumber: effect.attemptNumber,
              contentType: executionResult.result.contentType,
              executionResult: encodeStoredSourceApiExecutionResult(
                executionResult.result
              ),
              hasContinuation:
                executionResult.result.nextContinuationState !== undefined,
              httpStatus: executionResult.result.status,
              kind: "succeeded",
              pageIndex: effect.pageIndex,
              responseBytes: measureSourceApiResponseBytes(
                executionResult.result
              ),
              type: "record_page_fetch",
            },
            result: {
              kind: "succeeded" as const,
              result: executionResult.result,
            },
          };
        },
      });

      if (pageFetch.result.kind === "failed") {
        throw pageFetch.result.problem;
      }

      const lastCommittedEvent = requireLastCommittedEvent(pageFetch.decision);
      return {
        continuationToken: encodeSourceApiContinuationTokenValue(
          {
            actionId: pageFetch.decision.actionId,
            prepared: input.continuation.prepared,
            preparedRequestFingerprint:
              input.continuation.preparedRequestFingerprint,
            result: pageFetch.result.result,
            resumeFromEventId: lastCommittedEvent.id,
            secret: input.c.var.runtime.crypto.masterEncryptionKey,
          },
          input.dependencies
        ),
        preview,
        result: pageFetch.result.result,
      };
    },
    catch: (error) => ensureCliServiceProblem(error),
  });
}

async function executePreparedSourceApiAttempt(input: {
  actor: SourceApiActorContext;
  attemptNumber: number;
  c: CliHonoContext;
  continuationState?: SourceApiContinuationTokenPayload["state"];
  dependencies: SourceApiServiceDependencies;
  pageIndex: number;
  prepared: PreparedSourceApi;
  source: PreparedSourceConnection;
}): Promise<
  | {
      kind: "succeeded";
      result: SourceApiExecutionResult;
    }
  | {
      commandPayload: Extract<
        SourceApiActionCommandPayload,
        { type: "record_page_fetch"; kind: "terminal_failure" }
      >;
      kind: "failed";
      problem: ReturnType<typeof createCliServiceProblem>;
    }
> {
  const validity = await assertPreparedSourceApiStillValid(
    {
      actor: input.actor,
      prepared: input.prepared,
      source: input.source,
    },
    input.dependencies
  );

  if (validity.isErr()) {
    const failure = toExecutePageFailure(validity.error, input.dependencies);
    return {
      commandPayload: {
        attemptNumber: input.attemptNumber,
        detail: failure.problem.message,
        failureCode: failure.failureCode,
        kind: "terminal_failure",
        pageIndex: input.pageIndex,
        type: "record_page_fetch",
      },
      kind: "failed",
      problem: failure.problem,
    };
  }

  const execution = await executePreparedSourceApiResult(
    {
      actor: input.actor,
      ...(input.continuationState === undefined ||
      input.continuationState === null
        ? {}
        : { continuation: input.continuationState }),
      prepared: input.prepared,
      source: input.source,
    },
    input.dependencies
  );

  if (execution.isErr()) {
    const failure = toExecutePageFailure(execution.error, input.dependencies);
    return {
      commandPayload: {
        attemptNumber: input.attemptNumber,
        detail: failure.problem.message,
        failureCode: failure.failureCode,
        kind: "terminal_failure",
        pageIndex: input.pageIndex,
        type: "record_page_fetch",
      },
      kind: "failed",
      problem: failure.problem,
    };
  }

  return {
    kind: "succeeded",
    result: execution.value,
  };
}

async function dispatchStoredSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
  TResult,
>(input: {
  actorSnapshot: WorkflowActorSnapshot;
  currentDecision: StoredAcceptedSourceApiActionDecision;
  db: Database;
  expectedEffectType: EffectType;
  organizationId: string;
  replay: (input: {
    effect: Extract<SourceApiActionEffect, { type: EffectType }>;
    stored: StoredAcceptedSourceApiActionResultCommand;
  }) => Promise<TResult> | TResult;
  requestId: string;
  run: (
    effect: Extract<SourceApiActionEffect, { type: EffectType }>
  ) => Promise<{
    commandPayload: SourceApiActionCommandPayload;
    result: TResult;
  }>;
}): Promise<{
  decision: StoredAcceptedSourceApiActionDecision;
  effect: Extract<SourceApiActionEffect, { type: EffectType }>;
  result: TResult;
}> {
  // Comment: source_api_action still keeps drafts and continuation state off
  // the action state row, but replayable result commands now carry the minimum
  // data needed to reuse completed external work instead of refetching it.
  const originEvent = requireLastCommittedEvent(input.currentDecision);
  const effectDispatch = await loadRequiredSourceApiActionEffect({
    actionId: input.currentDecision.actionId,
    db: input.db,
    expectedEffectType: input.expectedEffectType,
    originEventId: originEvent.id,
  });

  const stored = await loadStoredAcceptedSourceApiActionResultCommand({
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
    throw createSourceApiAuditProblem(
      `source_api_action effect ${effectDispatch.id} is ${effectDispatch.status} without a stored result command`
    );
  }

  await leaseSourceApiActionEffect({
    db: input.db,
    effectDispatch,
  });

  try {
    const outcome = await input.run(effectDispatch.effect);
    const decision = await storeAcceptedSourceApiActionCommand({
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

    await completeSourceApiActionEffect({
      db: input.db,
      effectId: effectDispatch.id,
    });

    return {
      decision,
      effect: effectDispatch.effect,
      result: outcome.result,
    };
  } catch (error) {
    await releaseSourceApiActionEffect({
      db: input.db,
      effectId: effectDispatch.id,
      error,
    });
    throw error;
  }
}

async function storeAcceptedSourceApiActionCommand(
  input: Omit<SourceApiActionCommand, "family" | "observedAt"> & {
    db: Database;
  }
): Promise<StoredAcceptedSourceApiActionDecision> {
  const stored = await storeSourceApiActionCommand({
    command: {
      ...input,
      family: "source_api_action",
      observedAt: new Date(),
    },
    db: input.db,
  });

  if (stored.isErr()) {
    throw createSourceApiAuditProblem(
      `source_api_action ${input.commandPayload.type} could not be stored`,
      stored.error
    );
  }

  if (stored.value.kind !== "accepted") {
    throw createSourceApiAuditProblem(
      `source_api_action ${input.commandPayload.type} was rejected with ${stored.value.rejectCode}`
    );
  }

  return stored.value;
}

async function loadRequiredSourceApiActionEffect<
  EffectType extends SourceApiActionEffect["type"],
>(input: {
  actionId: string;
  db: Database;
  expectedEffectType: EffectType;
  originEventId: string;
}): Promise<{
  attemptCount: number;
  effect: Extract<SourceApiActionEffect, { type: EffectType }>;
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
        eq(workflowEffectDispatches.family, "source_api_action"),
        eq(workflowEffectDispatches.originEventId, input.originEventId)
      )
    )
    .orderBy(
      asc(workflowEffectDispatches.createdAt),
      asc(workflowEffectDispatches.id)
    )
    .limit(1);

  if (!row) {
    throw createSourceApiAuditProblem(
      `source_api_action effect ${input.expectedEffectType} is missing for origin event ${input.originEventId}`
    );
  }

  const parsedEffect = SourceApiActionEffectSchema.safeParse({
    type: row.effectType,
    ...row.payloadJson,
  });

  if (!parsedEffect.success) {
    throw createSourceApiAuditProblem(
      `source_api_action effect ${row.effectType} payload is corrupt`,
      parsedEffect.error
    );
  }

  if (parsedEffect.data.type !== input.expectedEffectType) {
    throw createSourceApiAuditProblem(
      `source_api_action expected effect ${input.expectedEffectType} but loaded ${parsedEffect.data.type}`
    );
  }

  return {
    attemptCount: row.attemptCount,
    effect: parsedEffect.data as Extract<
      SourceApiActionEffect,
      { type: EffectType }
    >,
    effectKey: row.effectKey,
    id: row.id,
    originEventId: row.originEventId,
    status: row.status,
  };
}

async function loadStoredAcceptedSourceApiActionResultCommand(input: {
  commandInvocationId: string;
  db: Database;
}): Promise<StoredAcceptedSourceApiActionResultCommand | null> {
  const storedCommand = await input.db.query.workflowCommands.findFirst({
    where: and(
      eq(workflowCommands.family, "source_api_action"),
      eq(workflowCommands.commandInvocationId, input.commandInvocationId)
    ),
  });

  if (storedCommand === undefined) {
    return null;
  }

  if (storedCommand.decisionKind !== "accepted") {
    throw createSourceApiAuditProblem(
      `source_api_action stored result command ${input.commandInvocationId} was unexpectedly rejected`
    );
  }

  if (storedCommand.actionId === null) {
    throw createSourceApiAuditProblem(
      `source_api_action stored result command ${input.commandInvocationId} is missing its action id`
    );
  }

  const events = await input.db
    .select()
    .from(sourceApiActionEvents)
    .where(eq(sourceApiActionEvents.commandId, storedCommand.id))
    .orderBy(asc(sourceApiActionEvents.sequence));

  return {
    commandPayload: {
      type: storedCommand.commandType,
      ...storedCommand.commandPayloadJson,
    },
    decision: {
      actionId: storedCommand.actionId,
      commandId: storedCommand.id,
      events: events.map((row) => {
        const parsed = SourceApiActionEventSchema.safeParse({
          type: row.eventType,
          ...row.payloadJson,
        });
        if (!parsed.success) {
          throw createSourceApiAuditProblem(
            `source_api_action stored result command ${input.commandInvocationId} has a corrupt ${row.eventType} event payload`,
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
      family: "source_api_action",
      idempotency: "replayed" as const,
      kind: "accepted" as const,
    },
  };
}

function toStoredSourceLookupResult(
  decision: StoredAcceptedSourceApiActionDecision
): { kind: "found" } | { kind: "not_found" } {
  const event = requireLastCommittedEvent(decision);

  switch (event.type) {
    case "source_loaded":
      return {
        kind: "found",
      };
    case "source_not_found":
      return {
        kind: "not_found",
      };
    default:
      throw createSourceApiAuditProblem(
        `source_api_action replay expected a source lookup event but loaded ${event.type}`
      );
  }
}

function toStoredDescriptorResolutionResult(
  commandPayload: StoredAcceptedSourceApiActionResultCommand["commandPayload"]
): DescriptorResolutionResult {
  const parsed =
    StoredDescriptorResolutionResultPayloadSchema.safeParse(commandPayload);
  if (!parsed.success) {
    throw createSourceApiAuditProblem(
      "source_api_action stored descriptor resolution payload is corrupt",
      parsed.error
    );
  }

  if (parsed.data.kind === "resolved") {
    return {
      descriptor: parsed.data.descriptor,
      kind: "resolved",
    };
  }

  return {
    kind: "failed",
    problem: createCliServiceProblem({
      detail: parsed.data.detail,
      key:
        parsed.data.failureCode === "permission_denied"
          ? "SOURCE_API_FORBIDDEN"
          : "SOURCE_API_SOURCE_UNAVAILABLE",
    }),
  };
}

function toStoredRequestPreparationResult(
  decision: StoredAcceptedSourceApiActionDecision
): RequestPreparationResult {
  const event = requireLastCommittedEvent(decision);

  switch (event.type) {
    case "request_prepared":
      return {
        kind: "prepared",
      };
    case "request_preparation_failed":
      return {
        kind: "failed",
        problem: createCliServiceProblem({
          detail: event.detail,
          key:
            event.failureCode === "permission_denied"
              ? "SOURCE_API_FORBIDDEN"
              : "SOURCE_REQUEST_INVALID",
        }),
      };
    default:
      throw createSourceApiAuditProblem(
        `source_api_action replay expected a request preparation event but loaded ${event.type}`
      );
  }
}

function toStoredPageFetchResult(
  commandPayload: StoredAcceptedSourceApiActionResultCommand["commandPayload"]
): PageFetchResult {
  const parsed = StoredPageFetchResultPayloadSchema.safeParse(commandPayload);
  if (!parsed.success) {
    throw createSourceApiAuditProblem(
      "source_api_action stored page fetch payload is corrupt",
      parsed.error
    );
  }

  switch (parsed.data.kind) {
    case "succeeded":
      return {
        kind: "succeeded",
        result: decodeStoredSourceApiExecutionResult(
          parsed.data.executionResult
        ),
      };
    case "retryable_failure":
      return {
        kind: "failed",
        problem: createCliServiceProblem({
          detail: parsed.data.detail,
          key: "SOURCE_API_EXECUTION_FAILED",
        }),
      };
    case "terminal_failure":
      return {
        kind: "failed",
        problem: createCliServiceProblem({
          detail: parsed.data.detail,
          key: toCliServiceProblemKeyForPageFetchFailure(
            parsed.data.failureCode
          ),
        }),
      };
  }
}

function encodeStoredSourceApiExecutionResult(
  result: SourceApiExecutionResult
): StoredSourceApiExecutionResult {
  return {
    body: encodeStoredSourceApiResponseBody(result.body),
    contentType: result.contentType,
    headers: [...result.headers],
    ...(result.nextContinuationState === undefined
      ? {}
      : { nextContinuationState: result.nextContinuationState }),
    operation: result.operation,
    ...(result.selector === undefined ? {} : { selector: result.selector }),
    source: result.source,
    status: result.status,
  };
}

function decodeStoredSourceApiExecutionResult(
  result: StoredSourceApiExecutionResult
): SourceApiExecutionResult {
  return {
    body: decodeStoredSourceApiResponseBody(result.body),
    contentType: result.contentType,
    headers: [...result.headers],
    ...(result.nextContinuationState === undefined
      ? {}
      : { nextContinuationState: result.nextContinuationState }),
    operation: result.operation,
    ...(result.selector === undefined ? {} : { selector: result.selector }),
    source: result.source,
    status: result.status,
  };
}

function encodeStoredSourceApiResponseBody(
  body: SourceApiExecutionResult["body"]
) {
  switch (body.kind) {
    case "binary":
      return {
        base64: Buffer.from(body.value).toString("base64"),
        kind: "binary" as const,
      };
    case "json":
      return {
        kind: "json" as const,
        value: body.value,
      };
    case "text":
      return {
        kind: "text" as const,
        value: body.value,
      };
    case "none":
      return {
        kind: "none" as const,
      };
  }
}

function decodeStoredSourceApiResponseBody(
  body: StoredSourceApiExecutionResult["body"]
): SourceApiExecutionResult["body"] {
  switch (body.kind) {
    case "binary":
      return {
        kind: "binary",
        value: Buffer.from(body.base64, "base64"),
      };
    case "json":
      return {
        kind: "json",
        value: body.value as never,
      };
    case "text":
      return {
        kind: "text",
        value: body.value,
      };
    case "none":
      return {
        kind: "none",
      };
  }
}

async function loadRequiredPreparedSourceConnection(input: {
  c: CliHonoContext;
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >;
  organizationId: string;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}): Promise<PreparedSourceConnection> {
  const loaded = await loadPreparedSourceConnection(input);

  if (loaded.kind !== "loaded") {
    throw createSourceApiAuditProblem(
      `source_api_action replay could not reload source "${input.source.sourceKey}" for a downstream effect`
    );
  }

  return loaded.source;
}

async function loadRequiredPreparedSourceApi(input: {
  actor: SourceApiActorContext;
  c: CliHonoContext;
  dependencies: SourceApiServiceDependencies;
  descriptor: SourceApiDescriptor | null;
  draft: SourceApiDraft;
  prepared: PreparedSourceApi | null;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}): Promise<PreparedSourceApi> {
  if (input.prepared !== null) {
    return input.prepared;
  }

  const descriptor = requireResolvedSourceApiDescriptor(input.descriptor);
  const source = await loadRequiredPreparedSourceConnection({
    c: input.c,
    dependencies: input.dependencies,
    organizationId: input.actor.organizationId,
    source: input.source,
  });
  const prepared = await prepareSourceApiDraftResult(
    {
      actor: input.actor,
      descriptor,
      draft: input.draft,
      source,
    },
    input.dependencies
  );

  if (prepared.isErr()) {
    throw createSourceApiAuditProblem(
      "source_api_action replay could not rebuild the prepared request",
      prepared.error
    );
  }

  return prepared.value;
}

function toCliServiceProblemKeyForPageFetchFailure(
  failureCode:
    | "execution_failed"
    | "execution_state_invalid"
    | "request_failed"
    | "request_timed_out"
) {
  switch (failureCode) {
    case "execution_state_invalid":
      return "SOURCE_API_EXECUTION_STATE_INVALID" as const;
    case "request_failed":
    case "request_timed_out":
      return "SOURCE_API_EXECUTION_FAILED" as const;
    case "execution_failed":
      return "SOURCE_API_EXECUTION_FAILED" as const;
  }
}

async function leaseSourceApiActionEffect(input: {
  db: Database;
  effectDispatch: Pick<LoadedSourceApiActionEffect, "attemptCount" | "id">;
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
    throw createSourceApiAuditProblem(
      `source_api_action effect ${input.effectDispatch.id} could not be leased`
    );
  }
}

async function completeSourceApiActionEffect(input: {
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
    throw createSourceApiAuditProblem(
      `source_api_action effect ${input.effectId} could not be completed`
    );
  }
}

async function releaseSourceApiActionEffect(input: {
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

async function loadPreparedSourceConnection(input: {
  c: CliHonoContext;
  dependencies: Pick<
    SourceApiServiceDependencies,
    "prepareDataSourceCredentials" | "runCliLoadSourceEffect"
  >;
  organizationId: string;
  source: Pick<
    SourceApiActionSourceDescriptor,
    "provider" | "sourceId" | "sourceKey"
  >;
}): Promise<LoadedPreparedSourceResult> {
  const source = await input.dependencies.runCliLoadSourceEffect({
    db: input.c.var.storage.db,
    effect: {
      kind: "load_source",
      organizationId: input.organizationId,
      sourceKey: input.source.sourceKey,
    },
  });

  if (source.kind === "not_found") {
    return {
      detail: `source "${input.source.sourceKey}" is no longer available`,
      kind: "not_found",
    };
  }

  if (
    source.source.id !== input.source.sourceId ||
    source.source.provider !== input.source.provider
  ) {
    return {
      detail: "Source API execution state no longer matches the current source",
      kind: "unavailable",
    };
  }

  const preparedCredentials =
    await input.dependencies.prepareDataSourceCredentials({
      dataSource: source.source,
      masterEncryptionKey: input.c.var.runtime.crypto.masterEncryptionKey,
    });

  if (preparedCredentials.isErr()) {
    return {
      detail: preparedCredentials.error.message,
      kind: "unavailable",
    };
  }

  return {
    kind: "loaded",
    source: {
      credentials: preparedCredentials.value.credentials,
      displayName: source.source.displayName,
      id: source.source.id,
      provider: source.source.provider,
      sourceKey: source.source.sourceKey,
    },
  };
}

function toSourceApiActionSourceDescriptor(
  source: Pick<
    CliQuerySourceRecord,
    "displayName" | "id" | "provider" | "sourceKey"
  >
): SourceApiActionSourceDescriptor {
  return {
    displayName: source.displayName,
    provider: source.provider,
    sourceId: source.id,
    sourceKey: source.sourceKey,
  };
}

function buildInitialRequestDescriptor(
  draft: Pick<
    SourceApiDraft,
    "descriptorVersion" | "methodOverride" | "operation" | "selector"
  >
): SourceApiActionRequestDescriptor {
  return {
    descriptorVersion: draft.descriptorVersion ?? null,
    kind: null,
    method: draft.methodOverride ?? null,
    operation: draft.operation,
    paginationPolicy: null,
    selector: draft.selector ?? null,
  };
}

function buildResolvedRequestDescriptor(input: {
  descriptor: SourceApiDescriptor;
  draft: Pick<SourceApiDraft, "methodOverride" | "operation" | "selector">;
}): SourceApiActionRequestDescriptor {
  const operation =
    input.descriptor.operations.find(
      (candidate) => candidate.name === input.draft.operation.trim()
    ) ?? null;

  return {
    descriptorVersion: input.descriptor.descriptorVersion,
    kind: operation?.kind ?? null,
    method:
      input.draft.methodOverride ??
      operation?.methodPolicy.defaultMethod ??
      null,
    operation: input.draft.operation,
    paginationPolicy: operation?.paginationPolicy ?? null,
    selector: input.draft.selector ?? null,
  };
}

function toDescriptorResolutionFailure(
  problem: ReturnType<typeof createCliServiceProblem>,
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
) {
  const normalizedProblem =
    problem.key === "SOURCE_API_FORBIDDEN"
      ? problem
      : createSourceApiConnectProblem({
          error: problem,
          phase: "describe",
          renderError: dependencies.toCliErrorMessage,
        });

  return {
    failureCode:
      normalizedProblem.key === "SOURCE_API_FORBIDDEN"
        ? ("permission_denied" as const)
        : ("descriptor_unavailable" as const),
    problem: normalizedProblem,
  };
}

function toRequestPreparationFailure(
  problem: ReturnType<typeof createCliServiceProblem>,
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
) {
  const normalizedProblem =
    problem.key === "SOURCE_API_FORBIDDEN" ||
    problem.key === "SOURCE_REQUEST_INVALID"
      ? problem
      : createSourceApiConnectProblem({
          error: problem,
          phase: "prepare",
          renderError: dependencies.toCliErrorMessage,
        });

  return {
    failureCode:
      normalizedProblem.key === "SOURCE_API_FORBIDDEN"
        ? ("permission_denied" as const)
        : ("invalid_request" as const),
    problem: normalizedProblem,
  };
}

function toExecutePageFailure(
  problem: ReturnType<typeof createCliServiceProblem>,
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">
) {
  const normalizedProblem =
    problem.key === "SOURCE_API_EXECUTION_STATE_INVALID" ||
    problem.key === "SOURCE_REQUEST_INVALID" ||
    problem.key === "SOURCE_API_FORBIDDEN"
      ? problem
      : createSourceApiConnectProblem({
          error: problem,
          phase: "execute",
          renderError: dependencies.toCliErrorMessage,
        });

  return {
    failureCode: classifyExecuteFailureCode(normalizedProblem),
    problem: normalizedProblem,
  };
}

function classifyExecuteFailureCode(
  problem: ReturnType<typeof createCliServiceProblem>
) {
  if (problem.key === "SOURCE_API_EXECUTION_STATE_INVALID") {
    return "execution_state_invalid" as const;
  }

  if (problem.key === "SOURCE_REQUEST_INVALID") {
    return "request_failed" as const;
  }

  if (/timed out/i.test(problem.message)) {
    return "request_timed_out" as const;
  }

  return "execution_failed" as const;
}

function encodeSourceApiContinuationTokenValue(
  input: {
    actionId: string;
    prepared: PreparedSourceApi;
    preparedRequestFingerprint: string;
    result: SourceApiExecutionResult;
    resumeFromEventId: string;
    secret: string | Uint8Array;
  },
  dependencies: Pick<
    SourceApiServiceDependencies,
    "encodeSourceApiContinuationToken"
  >
) {
  if (input.result.nextContinuationState === undefined) {
    return undefined;
  }

  return dependencies.encodeSourceApiContinuationToken({
    actionId: input.actionId,
    prepared: input.prepared,
    preparedRequestFingerprint: input.preparedRequestFingerprint,
    resumeFromEventId: input.resumeFromEventId,
    secret: input.secret,
    state: input.result.nextContinuationState,
  });
}

function measureSourceApiResponseBytes(result: SourceApiExecutionResult) {
  switch (result.body.kind) {
    case "binary":
      return result.body.value.byteLength;
    case "json":
      return Buffer.byteLength(JSON.stringify(result.body.value), "utf8");
    case "text":
      return Buffer.byteLength(result.body.value, "utf8");
    case "none":
      return null;
  }
}

function assertMatchingPreparedRequestFingerprint(input: {
  expectedFingerprint: string;
  prepared: PreparedSourceApi;
}) {
  if (input.prepared.preparedBinding === input.expectedFingerprint) {
    return;
  }

  throw createCliServiceProblem({
    detail: "Source API execution state no longer matches the prepared request",
    key: "SOURCE_API_EXECUTION_STATE_INVALID",
  });
}

function requireLastCommittedEvent(
  decision: StoredAcceptedSourceApiActionDecision
) {
  const event = decision.events.at(-1);
  if (!event) {
    throw createSourceApiAuditProblem(
      `source_api_action ${decision.commandId} committed without events`
    );
  }

  return event;
}

function requireResolvedSourceApiDescriptor(
  descriptor: SourceApiDescriptor | null
) {
  if (descriptor === null) {
    throw createSourceApiAuditProblem(
      "source_api_action descriptor cache was missing during prepare_request"
    );
  }

  return descriptor;
}

function ensureCliServiceProblem(error: unknown) {
  if (error instanceof Error && error.name === "CliConnectProblem") {
    return error as ReturnType<typeof createCliServiceProblem>;
  }

  return createCliServiceProblem({
    ...(error === undefined ? {} : { cause: error }),
    detail: toCliErrorMessage(error),
    key: "SOURCE_API_EXECUTION_FAILED",
  });
}

function createSourceApiAuditProblem(detail: string, cause?: unknown) {
  return createCliServiceProblem({
    ...(cause === undefined ? {} : { cause }),
    detail,
    key: "SOURCE_API_PREPARATION_FAILED",
  });
}
