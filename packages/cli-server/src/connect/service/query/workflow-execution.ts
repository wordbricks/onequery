import { Result } from "better-result";

import { CliConnectProblem } from "../../error";
import type { CliServiceResult } from "../result";
import { toCliQueryExecutionFailureResult } from "./workflow-outcome";
import { runPreparedCliQueryWorkflow } from "./workflow-preparation";
import type { CliQueryExecutionWorkflowResult } from "./workflow-result";
import { createQueryAuditProblem } from "./workflow-runtime";
import {
  runQueryCredentialsLoadStep,
  runQueryExecutionStep,
  runQueryUsagePersistenceStep,
} from "./workflow-steps";
import type { CliQueryExecutionWorkflowInput } from "./workflow-types";

export async function runCliQueryExecutionWorkflowResult(
  input: CliQueryExecutionWorkflowInput
): Promise<CliServiceResult<CliQueryExecutionWorkflowResult>> {
  return Result.tryPromise({
    try: async (): Promise<CliQueryExecutionWorkflowResult> => {
      const timeoutMs = input.timeoutMs ?? null;
      const preparation = await runPreparedCliQueryWorkflow({
        actorSnapshot: input.actorSnapshot,
        db: input.db,
        dispatch: input.dispatch,
        mode: "start_execute",
        org: input.org,
        requestId: input.requestId,
        sourceName: input.sourceName,
        sql: input.sql,
      });

      if (preparation.kind !== "ready") {
        return preparation.result;
      }

      let loadedState = preparation.prepared.loadedState;

      const credentials = await runQueryCredentialsLoadStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: preparation.prepared.validationDecision,
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
        truncated: preparation.prepared.truncated,
      });
      loadedState = execution.loadedState;

      if (execution.step.result.kind !== "succeeded") {
        return toCliQueryExecutionFailureResult({
          requestId: input.requestId,
          result: execution.step.result,
        });
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
