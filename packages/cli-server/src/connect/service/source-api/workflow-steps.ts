import type {
  PreparedSourceApi,
  SourceApiActorContext,
  SourceApiDescriptor,
  SourceApiDraft,
} from "@onequery/server/source-api";

import type { SourceApiActionEffect } from "../../../audit";
import { createCliConnectSourceNotFoundProblem } from "../errors";
import { createCliServiceProblem } from "../result";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  createSourceApiConnectProblem,
  prepareSourceApiDraftResult,
  resolveSourceApiDescriptor,
} from "./runtime";
import {
  encodeStoredSourceApiExecutionResult,
  measureSourceApiResponseBytes,
  toSourceApiActionSourceDescriptor,
  toStoredDescriptorResolutionResult,
  toStoredPageFetchResult,
  toStoredRequestPreparationResult,
  toStoredSourceLookupResult,
} from "./workflow-codec";
import {
  dispatchStoredSourceApiActionEffect,
  loadPreparedSourceConnection,
  loadRequiredPreparedSourceConnection,
  storeAcceptedSourceApiActionCommand,
} from "./workflow-runtime";
import type {
  DescriptorResolutionResult,
  DispatchedSourceApiActionEffect,
  PageFetchResult,
  PreparedSourceApiWorkflow,
  PreparedSourceApiWorkflowInput,
  RequestPreparationResult,
  SourceApiPageFetchAttemptResult,
  SourceApiSourceLookupResult,
} from "./workflow-types";

export async function runPreparedSourceApiWorkflow(
  input: PreparedSourceApiWorkflowInput
): Promise<PreparedSourceApiWorkflow> {
  const startDecision = await dispatchStartSourceApiWorkflow(input);

  const sourceLookup = await dispatchStoredSourceApiActionEffect<
    "load_source",
    SourceApiSourceLookupResult
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
            kind: "not_found",
          } satisfies SourceApiSourceLookupResult,
        };
      }

      return {
        commandPayload: {
          kind: "found",
          source: toSourceApiActionSourceDescriptor(source.source),
          type: "record_source_lookup",
        },
        result: {
          kind: "found",
        } satisfies SourceApiSourceLookupResult,
      };
    },
  });

  if (sourceLookup.result.kind === "not_found") {
    throw createCliConnectSourceNotFoundProblem(input.orgSlug, input.sourceKey);
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
    replay: ({ stored }) =>
      toStoredDescriptorResolutionResult(stored.commandPayload),
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
            kind: "failed",
            problem,
          } satisfies DescriptorResolutionResult,
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
            kind: "failed",
            problem: failure.problem,
          } satisfies DescriptorResolutionResult,
        };
      }

      return {
        commandPayload: {
          descriptor: descriptor.value,
          kind: "resolved",
          requestDescriptor: input.requestDescriptor(descriptor.value),
          type: "record_descriptor_resolution",
        },
        result: {
          descriptor: descriptor.value,
          kind: "resolved",
        } satisfies DescriptorResolutionResult,
      };
    },
  });

  if (descriptorResolution.result.kind === "failed") {
    throw descriptorResolution.result.problem;
  }

  return {
    decision: descriptorResolution.decision,
    descriptor: descriptorResolution.result.descriptor,
  };
}

export async function runSourceApiRequestPreparationStep(input: {
  actor: SourceApiActorContext;
  actorSnapshot: PreparedSourceApiWorkflowInput["actorSnapshot"];
  currentDecision: PreparedSourceApiWorkflow["decision"];
  dependencies: SourceApiServiceDependencies;
  descriptor: SourceApiDescriptor;
  draft: SourceApiDraft;
  organizationId: string;
  requestId: string;
  c: PreparedSourceApiWorkflowInput["c"];
}): Promise<{
  preparedRequest: PreparedSourceApi | null;
  step: DispatchedSourceApiActionEffect<
    "prepare_request",
    RequestPreparationResult
  >;
}> {
  let preparedRequest: PreparedSourceApi | null = null;

  const step = await dispatchStoredSourceApiActionEffect<
    "prepare_request",
    RequestPreparationResult
  >({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.c.var.storage.db,
    expectedEffectType: "prepare_request",
    organizationId: input.organizationId,
    replay: ({ stored }) => toStoredRequestPreparationResult(stored.decision),
    requestId: input.requestId,
    run: async (effect) => {
      const source = await loadRequiredPreparedSourceConnection({
        c: input.c,
        dependencies: input.dependencies,
        organizationId: input.organizationId,
        source: effect.source,
      });
      const prepared = await prepareSourceApiDraftResult(
        {
          actor: input.actor,
          descriptor: input.descriptor,
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
            kind: "failed",
            problem: failure.problem,
          } satisfies RequestPreparationResult,
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
          kind: "prepared",
        } satisfies RequestPreparationResult,
      };
    },
  });

  return {
    preparedRequest,
    step,
  };
}

export async function runSourceApiPageFetchStep(input: {
  actorSnapshot: PreparedSourceApiWorkflowInput["actorSnapshot"];
  currentDecision: PreparedSourceApiWorkflow["decision"];
  db: import("@onequery/db/server").Database;
  organizationId: string;
  requestId: string;
  runAttempt: (
    effect: Extract<SourceApiActionEffect, { type: "execute_page" }>
  ) => Promise<SourceApiPageFetchAttemptResult>;
}): Promise<DispatchedSourceApiActionEffect<"execute_page", PageFetchResult>> {
  return dispatchStoredSourceApiActionEffect<"execute_page", PageFetchResult>({
    actorSnapshot: input.actorSnapshot,
    currentDecision: input.currentDecision,
    db: input.db,
    expectedEffectType: "execute_page",
    organizationId: input.organizationId,
    replay: ({ stored }) => toStoredPageFetchResult(stored.commandPayload),
    requestId: input.requestId,
    run: async (effect) => {
      const executionResult = await input.runAttempt(effect);

      if (executionResult.kind === "failed") {
        return {
          commandPayload: executionResult.commandPayload,
          result: {
            kind: "failed",
            problem: executionResult.problem,
          } satisfies PageFetchResult,
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
          responseBytes: measureSourceApiResponseBytes(executionResult.result),
          type: "record_page_fetch",
        },
        result: {
          kind: "succeeded",
          result: executionResult.result,
        } satisfies PageFetchResult,
      };
    },
  });
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

async function dispatchStartSourceApiWorkflow(
  input: PreparedSourceApiWorkflowInput
) {
  return storeAcceptedSourceApiActionCommand({
    actionId: null,
    actorSnapshot: input.actorSnapshot,
    causedByEventId: null,
    commandInvocationId: input.commandInvocationId,
    commandPayload: input.startCommandPayload,
    db: input.c.var.storage.db,
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "cli",
  });
}
