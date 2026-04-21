import { Result } from "better-result";

import { CliConnectProblem } from "../../error";
import type { CliServiceResult } from "../result";
import { toCliSourceRecord } from "./workflow-codec";
import type { CliQueryValidationWorkflowResult } from "./workflow-result";
import {
  createQueryAuditProblem,
  storeAcceptedQueryActionCommand,
} from "./workflow-runtime";
import {
  createInitialQueryWorkflowLoadedState,
  runQuerySourceLookupStep,
  runQueryValidationStep,
} from "./workflow-steps";
import type { CliQueryValidationWorkflowInput } from "./workflow-types";

export async function runCliQueryValidationWorkflowResult(
  input: CliQueryValidationWorkflowInput
): Promise<CliServiceResult<CliQueryValidationWorkflowResult>> {
  return Result.tryPromise({
    try: async (): Promise<CliQueryValidationWorkflowResult> => {
      const timeoutMs = input.timeoutMs ?? null;
      const loadedState = createInitialQueryWorkflowLoadedState();

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
