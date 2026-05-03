import { Result } from "better-result";

import {
  loadPendingQueryActionEffectsViaJournal,
  loadQueryActionDecisionForEffectViaJournal,
} from "../../../audit";
import type { WorkflowActorSnapshot } from "../../../audit";
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

export type QueryUsagePersistenceRecoveryResult = {
  failed: number;
  recovered: number;
  skipped: number;
};

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

export async function recoverPendingQueryUsagePersistenceEffects(input: {
  actorSnapshot: WorkflowActorSnapshot;
  db: CliQueryExecutionWorkflowInput["db"];
  dispatch: Pick<CliQueryExecutionWorkflowInput["dispatch"], "persistUsage">;
  limit?: number;
  organizationId?: string;
  requestId?: string;
}): Promise<QueryUsagePersistenceRecoveryResult> {
  const pending = await loadPendingQueryActionEffectsViaJournal({
    db: input.db,
    limit: input.limit,
    organizationId: input.organizationId,
  });
  if (pending.isErr()) {
    throw createQueryAuditProblem(
      "query_action pending usage effects could not be loaded",
      pending.error
    );
  }

  const summary: QueryUsagePersistenceRecoveryResult = {
    failed: 0,
    recovered: 0,
    skipped: 0,
  };

  for (const effect of pending.value) {
    if (effect.effect.type !== "persist_usage") {
      summary.skipped += 1;
      continue;
    }

    const decision = await loadQueryActionDecisionForEffectViaJournal({
      actionId: effect.streamId,
      db: input.db,
      effectId: effect.effectId,
    });
    if (decision.isErr()) {
      throw createQueryAuditProblem(
        `query_action pending usage effect ${effect.effectId} could not be loaded from the journal`,
        decision.error
      );
    }

    if (decision.value?.kind !== "accepted") {
      summary.skipped += 1;
      continue;
    }

    try {
      await runQueryUsagePersistenceStep({
        actorSnapshot: input.actorSnapshot,
        currentDecision: {
          ...decision.value,
          freshEffects: [],
          journalEffects: [effect],
        },
        db: input.db,
        dispatch: input.dispatch,
        organizationId: effect.organizationId,
        requestId: input.requestId ?? "query-usage-recovery",
      });
      summary.recovered += 1;
    } catch (error) {
      summary.failed += 1;
      logCliEvent({
        details: {
          actionId: effect.streamId,
          effectId: effect.effectId,
          error: toCliErrorMessage(error),
          organizationId: effect.organizationId,
        },
        event: "cli.query.usage_persistence_recovery_failed",
        level: "warn",
      });
    }
  }

  return summary;
}
