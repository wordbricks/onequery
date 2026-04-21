import { Result } from "better-result";

import { CliConnectProblem } from "../../error";
import type { CliServiceResult } from "../result";
import type { CliQueryExecutionWorkflowResult } from "./workflow-result";
import {
  createQueryAuditProblem,
  storeAcceptedQueryActionCommand,
} from "./workflow-runtime";
import {
  createInitialQueryWorkflowLoadedState,
  runQueryCredentialsLoadStep,
  runQueryExecutionStep,
  runQuerySourceLookupStep,
  runQueryUsagePersistenceStep,
  runQueryValidationStep,
} from "./workflow-steps";
import type { CliQueryExecutionWorkflowInput } from "./workflow-types";

export async function runCliQueryExecutionWorkflowResult(
  input: CliQueryExecutionWorkflowInput
): Promise<CliServiceResult<CliQueryExecutionWorkflowResult>> {
  return Result.tryPromise({
    try: async (): Promise<CliQueryExecutionWorkflowResult> => {
      const timeoutMs = input.timeoutMs ?? null;
      let loadedState = createInitialQueryWorkflowLoadedState();

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

      const sourceLookup = await runQuerySourceLookupStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: startDecision,
        db: input.db,
        dispatch: input.dispatch,
        loadedState,
        org: input.org,
        requestId: input.requestId,
        sourceName: input.sourceName,
      });
      loadedState = sourceLookup.loadedState;

      if (sourceLookup.step.result.kind !== "queryable_source_loaded") {
        return sourceLookup.step.result;
      }

      const validation = await runQueryValidationStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: sourceLookup.step.decision,
        db: input.db,
        dispatch: input.dispatch,
        organizationId: input.org.id,
        requestId: input.requestId,
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

      const credentials = await runQueryCredentialsLoadStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: validation.decision,
        db: input.db,
        dispatch: input.dispatch,
        loadedState,
        organizationId: input.org.id,
        requestId: input.requestId,
      });
      loadedState = credentials.loadedState;

      if (credentials.step.result.kind === "credentials_invalid") {
        return {
          detail: credentials.step.result.detail,
          hint: "verify the source configuration and retry",
          kind: "query_preparation_failed",
          requestId: input.requestId,
        };
      }

      const execution = await runQueryExecutionStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: credentials.step.decision,
        db: input.db,
        dispatch: input.dispatch,
        loadedState,
        organizationId: input.org.id,
        requestId: input.requestId,
        timeoutMs,
        truncated: validationReady.truncated,
      });
      loadedState = execution.loadedState;

      if (execution.step.result.kind !== "succeeded") {
        switch (execution.step.result.kind) {
          case "query_unavailable":
            return {
              detail: execution.step.result.detail,
              kind: "query_unavailable",
              requestId: input.requestId,
              retryable: true,
            };
          case "query_timed_out":
            return {
              detail: execution.step.result.detail,
              kind: "query_timed_out",
              requestId: input.requestId,
              retryable: true,
            };
          case "query_execution_failed":
            return {
              detail: execution.step.result.detail,
              kind: "query_execution_failed",
              requestId: input.requestId,
              retryable: false,
            };
        }
      }

      const usagePersistence = await runQueryUsagePersistenceStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: execution.step.decision,
        db: input.db,
        dispatch: input.dispatch,
        organizationId: input.org.id,
        requestId: input.requestId,
      });

      return {
        kind: "response_ready",
        response: execution.step.result.response,
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
