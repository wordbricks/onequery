import { Result } from "better-result";

import { isCliFailure } from "../../../domain/failures";
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

      let resourceCache = preparation.prepared.resourceCache;

      const credentials = await runQueryCredentialsLoadStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: preparation.prepared.validationDecision,
        db: input.db,
        dispatch: input.dispatch,
        resourceCache,
        organizationId: input.org.id,
        requestId: input.requestId,
      });
      resourceCache = credentials.resourceCache;

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

      const usagePersistence = await runQueryUsagePersistenceStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: execution.decision,
        db: input.db,
        dispatch: input.dispatch,
        organizationId: input.org.id,
        requestId: input.requestId,
      });

      return {
        kind: "response_ready",
        response: execution.result.response,
        usagePersistence: usagePersistence.result,
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
