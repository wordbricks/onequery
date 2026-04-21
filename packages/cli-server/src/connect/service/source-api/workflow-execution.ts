import type {
  PreparedSourceApi,
  PreparedSourceConnection,
  SourceApiActorContext,
  SourceApiContinuationTokenPayload,
  SourceApiExecutionResult,
} from "@onequery/server/source-api";
import { Result } from "better-result";

import { storeSourceApiActionCommand } from "../../../audit";
import { createCliServiceProblem } from "../result";
import type { CliServiceResult } from "../result";
import type { CliHonoContext } from "../types";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  assertPreparedSourceApiStillValid,
  createSourceApiConnectProblem,
  executePreparedSourceApiResult,
} from "./runtime";
import {
  buildInitialRequestDescriptor,
  buildResolvedRequestDescriptor,
} from "./workflow-codec";
import { buildStartSourceApiExecuteCommandInvocationId } from "./workflow-command-id";
import {
  ensureCliServiceProblem,
  loadRequiredPreparedSourceApi,
  loadRequiredPreparedSourceConnection,
  requireLastCommittedEvent,
  createSourceApiAuditProblem,
} from "./workflow-runtime";
import {
  runPreparedSourceApiWorkflow,
  runSourceApiPageFetchStep,
  runSourceApiRequestPreparationStep,
} from "./workflow-steps";
import type {
  ResumeSourceApiExecuteWorkflowInput,
  SourceApiExecuteSuccess,
  SourceApiPageFetchAttemptResult,
  StartSourceApiExecuteWorkflowInput,
} from "./workflow-types";

type SourceApiPageFetchStepResult = Awaited<
  ReturnType<typeof runSourceApiPageFetchStep>
>;

export async function runStartSourceApiExecuteWorkflowResult(
  input: StartSourceApiExecuteWorkflowInput
): Promise<CliServiceResult<SourceApiExecuteSuccess>> {
  return Result.tryPromise({
    try: async () => {
      const preparation = await runPreparedSourceApiWorkflow({
        ...input,
        commandInvocationId: buildStartSourceApiExecuteCommandInvocationId({
          draft: input.draft,
          invokeMode: input.invokeMode,
          organizationId: input.organizationId,
          requestId: input.requestId,
          sourceKey: input.sourceKey,
        }),
        requestDescriptor: (descriptor) =>
          buildResolvedRequestDescriptor({
            descriptor,
            draft: input.draft,
          }),
        startCommandPayload: {
          invokeMode: input.invokeMode,
          requestDescriptor: buildInitialRequestDescriptor(input.draft),
          sourceKey: input.sourceKey,
          type: "start_invoke",
        },
      });

      const requestPreparation = await runSourceApiRequestPreparationStep({
        actor: input.actor,
        actorSnapshot: input.actorSnapshot,
        c: input.c,
        currentDecision: preparation.decision,
        dependencies: input.dependencies,
        descriptor: preparation.descriptor,
        draft: input.draft,
        organizationId: input.organizationId,
        requestId: input.requestId,
      });

      if (requestPreparation.step.result.kind === "failed") {
        throw requestPreparation.step.result.problem;
      }

      let preparedRequest = await loadRequiredPreparedSourceApi({
        actor: input.actor,
        c: input.c,
        dependencies: input.dependencies,
        descriptor: preparation.descriptor,
        draft: input.draft,
        prepared: requestPreparation.preparedRequest,
        source: requestPreparation.step.effect.source,
      });
      const preview =
        input.dependencies.createSourceApiPreview(preparedRequest);

      if (input.invokeMode === "preview_only") {
        return {
          preview,
        };
      }

      const pageFetch = await runSourceApiPageFetchStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: requestPreparation.step.decision,
        db: input.c.var.storage.db,
        organizationId: input.organizationId,
        requestId: input.requestId,
        runAttempt: async (effect) => {
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
            descriptor: preparation.descriptor,
            draft: input.draft,
            prepared: preparedRequest,
            source: effect.source,
          });
          preparedRequest = currentPrepared;
          assertMatchingPreparedRequestFingerprint({
            expectedFingerprint: effect.preparedRequestFingerprint,
            prepared: currentPrepared,
          });

          return executePreparedSourceApiAttempt({
            actor: input.actor,
            attemptNumber: effect.attemptNumber,
            c: input.c,
            dependencies: input.dependencies,
            pageIndex: effect.pageIndex,
            prepared: currentPrepared,
            source,
          });
        },
      });

      return buildSourceApiExecuteSuccess({
        decision: pageFetch.decision,
        dependencies: input.dependencies,
        prepared: preparedRequest,
        preparedRequestFingerprint: preparedRequest.preparedBinding,
        preview,
        result: requireSuccessfulSourceApiPageFetch(pageFetch),
        secret: input.c.var.runtime.crypto.masterEncryptionKey,
      });
    },
    catch: (error) => ensureCliServiceProblem(error),
  });
}

export async function runResumeSourceApiExecuteWorkflowResult(
  input: ResumeSourceApiExecuteWorkflowInput
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

      const pageFetch = await runSourceApiPageFetchStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: resumeDecision,
        db: input.c.var.storage.db,
        organizationId: input.organizationId,
        requestId: input.requestId,
        runAttempt: async (effect) => {
          assertMatchingPreparedRequestFingerprint({
            expectedFingerprint: effect.preparedRequestFingerprint,
            prepared: input.continuation.prepared,
          });

          return executePreparedSourceApiAttempt({
            actor: input.actor,
            attemptNumber: effect.attemptNumber,
            c: input.c,
            continuationState: input.continuation.state,
            dependencies: input.dependencies,
            pageIndex: effect.pageIndex,
            prepared: input.continuation.prepared,
            source: input.source,
          });
        },
      });

      return buildSourceApiExecuteSuccess({
        decision: pageFetch.decision,
        dependencies: input.dependencies,
        prepared: input.continuation.prepared,
        preparedRequestFingerprint:
          input.continuation.preparedRequestFingerprint,
        preview,
        result: requireSuccessfulSourceApiPageFetch(pageFetch),
        secret: input.c.var.runtime.crypto.masterEncryptionKey,
      });
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
}): Promise<SourceApiPageFetchAttemptResult> {
  const validity = await assertPreparedSourceApiStillValid(
    {
      actor: input.actor,
      prepared: input.prepared,
      source: input.source,
    },
    input.dependencies
  );

  if (validity.isErr()) {
    return toTerminalPageFetchFailureResult({
      attemptNumber: input.attemptNumber,
      dependencies: input.dependencies,
      pageIndex: input.pageIndex,
      problem: validity.error,
    });
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
    return toTerminalPageFetchFailureResult({
      attemptNumber: input.attemptNumber,
      dependencies: input.dependencies,
      pageIndex: input.pageIndex,
      problem: execution.error,
    });
  }

  return {
    kind: "succeeded",
    result: execution.value,
  };
}

function requireSuccessfulSourceApiPageFetch(
  step: SourceApiPageFetchStepResult
): SourceApiExecutionResult {
  if (step.result.kind === "failed") {
    throw step.result.problem;
  }

  return step.result.result;
}

function buildSourceApiExecuteSuccess(input: {
  decision: SourceApiPageFetchStepResult["decision"];
  dependencies: Pick<
    SourceApiServiceDependencies,
    "encodeSourceApiContinuationToken"
  >;
  prepared: PreparedSourceApi;
  preparedRequestFingerprint: string;
  preview: SourceApiExecuteSuccess["preview"];
  result: SourceApiExecutionResult;
  secret: string | Uint8Array;
}): SourceApiExecuteSuccess {
  const lastCommittedEvent = requireLastCommittedEvent(input.decision);

  return {
    continuationToken: encodeSourceApiContinuationTokenValue(
      {
        actionId: input.decision.actionId,
        prepared: input.prepared,
        preparedRequestFingerprint: input.preparedRequestFingerprint,
        result: input.result,
        resumeFromEventId: lastCommittedEvent.id,
        secret: input.secret,
      },
      input.dependencies
    ),
    preview: input.preview,
    result: input.result,
  };
}

function toTerminalPageFetchFailureResult(input: {
  attemptNumber: number;
  dependencies: Pick<SourceApiServiceDependencies, "toCliErrorMessage">;
  pageIndex: number;
  problem: ReturnType<typeof createCliServiceProblem>;
}): SourceApiPageFetchAttemptResult {
  const failure = toExecutePageFailure(input.problem, input.dependencies);

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
