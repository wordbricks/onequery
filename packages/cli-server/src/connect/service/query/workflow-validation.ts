import { Result } from "better-result";

import { CliConnectProblem } from "../../error";
import type { CliServiceResult } from "../result";
import { toCliSourceRecord } from "./workflow-codec";
import { runPreparedCliQueryWorkflow } from "./workflow-preparation";
import type { CliQueryValidationWorkflowResult } from "./workflow-result";
import { createQueryAuditProblem } from "./workflow-runtime";
import type { CliQueryValidationWorkflowInput } from "./workflow-types";

export async function runCliQueryValidationWorkflowResult(
  input: CliQueryValidationWorkflowInput
): Promise<CliServiceResult<CliQueryValidationWorkflowResult>> {
  return Result.tryPromise({
    try: async (): Promise<CliQueryValidationWorkflowResult> => {
      const preparation = await runPreparedCliQueryWorkflow({
        actorSnapshot: input.actorSnapshot,
        db: input.db,
        dispatch: input.dispatch,
        mode: "start_validate",
        org: input.org,
        requestId: input.requestId,
        sourceName: input.sourceName,
        sql: input.sql,
        timeoutMs: input.timeoutMs,
      });

      if (preparation.kind !== "ready") {
        return preparation.result;
      }

      return {
        kind: "ready",
        normalizedSql: preparation.prepared.normalizedSql,
        requestId: input.requestId,
        source: toCliSourceRecord(preparation.prepared.source),
        sourceName: input.sourceName,
        timeoutMs: input.timeoutMs,
        truncated: preparation.prepared.truncated,
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
