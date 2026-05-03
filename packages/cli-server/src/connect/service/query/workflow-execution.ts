import { Result } from "better-result";

import { isCliFailure } from "../../../domain/failures";
import { logCliEvent, toCliErrorMessage } from "../../../observability";
import type { CliServiceResult } from "../result";
import { toCliQueryExecutionFailureResult } from "./workflow-outcome";
import { runPreparedCliQueryWorkflow } from "./workflow-preparation";
import type { CliQueryExecutionWorkflowResult } from "./workflow-result";
import { createQueryAuditProblem } from "./workflow-runtime";
import {
  runQueryExecutionStep,
  runQueryUsagePersistenceStep,
} from "./workflow-steps";
import type { CliQueryExecutionWorkflowInput } from "./workflow-types";

export async function runCliQueryExecutionWorkflowResult(
  input: CliQueryExecutionWorkflowInput
): Promise<CliServiceResult<CliQueryExecutionWorkflowResult>> {
  return Result.tryPromise({
    try: async (): Promise<CliQueryExecutionWorkflowResult> => {
      const preparation = await runPreparedCliQueryWorkflow({
        actorSnapshot: input.actorSnapshot,
        db: input.db,
        dispatch: input.dispatch,
        mode: "start_execute",
        org: input.org,
        requestId: input.requestId,
        sourceName: input.sourceName,
        sql: input.sql,
        timeoutMs: input.timeoutMs,
      });

      if (preparation.kind !== "ready") {
        return preparation.result;
      }

      const resourceCache = preparation.prepared.resourceCache;

      const execution = await runQueryExecutionStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: preparation.prepared.preparationDecision,
        db: input.db,
        dispatch: input.dispatch,
        resourceCache,
        organizationId: input.org.id,
        requestId: input.requestId,
        timeoutMs: input.timeoutMs,
        truncated: preparation.prepared.truncated,
      });

      if (execution.result.kind !== "succeeded") {
        return toCliQueryExecutionFailureResult({
          requestId: input.requestId,
          result: execution.result,
        });
      }

      if (execution.decision.idempotency === "fresh") {
        scheduleQueryUsagePersistenceFollowUp({
          executionDecision: execution.decision,
          input,
        });
      }

      return {
        kind: "response_ready",
        response: execution.result.response,
      };
    },
    catch: (error) =>
      isCliFailure(error)
        ? error
        : createQueryAuditProblem(
            `query_action execution failed for source "${input.sourceName}"`,
            error
          ),
  });
}

function scheduleQueryUsagePersistenceFollowUp(input: {
  executionDecision: Awaited<
    ReturnType<typeof runQueryExecutionStep>
  >["decision"];
  input: CliQueryExecutionWorkflowInput;
}) {
  setTimeout(() => {
    void runQueryUsagePersistenceStep({
      actorSnapshot: input.input.actorSnapshot,
      currentDecision: input.executionDecision,
      db: input.input.db,
      dispatch: input.input.dispatch,
      organizationId: input.input.org.id,
      requestId: input.input.requestId,
    }).catch((error: unknown) => {
      logCliEvent({
        details: {
          error: toCliErrorMessage(error),
          organizationId: input.input.org.id,
          requestId: input.input.requestId,
          sourceName: input.input.sourceName,
        },
        event: "cli.query.usage_persistence_followup_failed",
        level: "warn",
      });
    });
  }, 0);
}
