import {
  TransactionRollbackError,
  workflowCommands,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { Result } from "better-result";

import type {
  WorkflowCommandEnvelope,
  WorkflowCommittedEvent,
  WorkflowDecision,
  WorkflowFamily,
  WorkflowStateBase,
} from "../kernel";
import { insertWorkflowEffectDispatches } from "./effect-dispatch";
import { WorkflowStorageWriteError } from "./errors";
import type { WorkflowStorageError } from "./errors";
import {
  buildCommittedEvents,
  foldCommittedEvents,
  requireAcceptedActionId,
  requireFoldedState,
} from "./folding";
import { toWorkflowPayloadJson } from "./serialization";
import type {
  StoredAcceptedWorkflowDecision,
  StoredRejectedWorkflowDecision,
  TransactionCommitOutcome,
  WorkflowStoreAdapter,
} from "./types";

export async function commitWorkflowDecision<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  actionId: string | null;
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  command: WorkflowCommandEnvelope<Family, CommandPayload>;
  currentState: State | null;
  db: Database;
  decision: WorkflowDecision<Event, Effect, RejectCode>;
}): Promise<
  Result<
    TransactionCommitOutcome<Family, Event, RejectCode>,
    WorkflowStorageError
  >
> {
  const { adapter, command, currentState, db, decision } = input;
  const actionId = input.actionId;

  let acceptedCommit: {
    actionId: string;
    events: readonly WorkflowCommittedEvent<Event>[];
    state: State;
  } | null = null;

  if (decision.kind === "accepted") {
    const committedEvents = buildCommittedEvents({
      events: decision.events,
      occurredAt: command.observedAt,
      startingSequence: currentState?.lastEventSequence ?? 0,
    });
    const foldedState = foldCommittedEvents({
      events: committedEvents,
      initialState: currentState,
      reduce: adapter.reduce,
    });
    if (foldedState.isErr()) {
      return Result.err(foldedState.error);
    }

    const requiredState = requireFoldedState({
      commandType: command.commandPayload.type,
      entity: "accepted_workflow_events",
      family: adapter.family,
      state: foldedState.value,
    });
    if (requiredState.isErr()) {
      return Result.err(requiredState.error);
    }

    const requiredActionId = requireAcceptedActionId({
      actionId,
      commandType: command.commandPayload.type,
      family: adapter.family,
    });
    if (requiredActionId.isErr()) {
      return Result.err(requiredActionId.error);
    }

    acceptedCommit = {
      actionId: requiredActionId.value,
      events: committedEvents,
      state: requiredState.value,
    };
  }

  try {
    const committed = await db.transaction(async (tx) => {
      const insertedCommands = await tx
        .insert(workflowCommands)
        .values({
          actionId,
          actorSnapshotJson: {
            authMode: command.actorSnapshot.authMode,
            email: command.actorSnapshot.email,
            membershipRoles: [...command.actorSnapshot.membershipRoles],
            userId: command.actorSnapshot.userId,
          },
          causedByEventId: command.causedByEventId,
          commandInvocationId: command.commandInvocationId,
          commandPayloadJson: toWorkflowPayloadJson(command.commandPayload),
          commandType: command.commandPayload.type,
          createdAt: command.observedAt,
          decisionKind: decision.kind,
          family: adapter.family,
          organizationId: command.organizationId,
          rejectCode: decision.kind === "rejected" ? decision.rejectCode : null,
          rejectDetail:
            decision.kind === "rejected"
              ? (decision.rejectDetail ?? null)
              : null,
          requestId: command.requestId,
          surface: command.surface,
        })
        .onConflictDoNothing()
        .returning({ id: workflowCommands.id });

      if (insertedCommands.length === 0) {
        return { kind: "race_lost" } satisfies TransactionCommitOutcome<
          Family,
          Event,
          RejectCode
        >;
      }

      const insertedCommand = insertedCommands[0];
      if (!insertedCommand) {
        throw new WorkflowStorageWriteError({
          ...(actionId === null ? {} : { actionId }),
          family: adapter.family,
          operation: "insert_command",
        });
      }

      const commandId = insertedCommand.id;

      if (decision.kind === "rejected") {
        return {
          actionId,
          commandId,
          family: adapter.family,
          kind: "rejected",
          rejectCode: decision.rejectCode,
          ...(decision.rejectDetail === undefined
            ? {}
            : { rejectDetail: decision.rejectDetail }),
        } satisfies StoredRejectedWorkflowDecision<Family, RejectCode>;
      }

      const accepted = acceptedCommit;
      if (accepted === null) {
        throw new WorkflowStorageWriteError({
          ...(actionId === null ? {} : { actionId }),
          family: adapter.family,
          operation: "prepare_accepted_decision",
        });
      }

      const insertedEvents = await adapter.insertEvents({
        actionId: accepted.actionId,
        commandId,
        events: accepted.events,
        tx,
      });

      if (!insertedEvents) {
        tx.rollback();
      }

      const lastCommittedEvent = accepted.events.at(-1);
      if (!lastCommittedEvent) {
        throw new WorkflowStorageWriteError({
          actionId: accepted.actionId,
          family: adapter.family,
          operation: "build_committed_events",
        });
      }

      await insertWorkflowEffectDispatches({
        actionId: accepted.actionId,
        effects: decision.effects,
        family: adapter.family,
        occurredAt: command.observedAt,
        originEventId: lastCommittedEvent.id,
        tx,
      });

      if (currentState === null) {
        await adapter.insertAction({
          actionId: accepted.actionId,
          organizationId: command.organizationId,
          state: accepted.state,
          tx,
        });
      } else {
        const updated = await adapter.updateAction({
          actionId: accepted.actionId,
          expectedLastEventId: currentState.lastEventId,
          expectedLastEventSequence: currentState.lastEventSequence,
          state: accepted.state,
          tx,
        });

        if (!updated) {
          tx.rollback();
        }
      }

      return {
        actionId: accepted.actionId,
        commandId,
        events: accepted.events,
        family: adapter.family,
        kind: "accepted",
      } satisfies StoredAcceptedWorkflowDecision<Family, Event>;
    });

    return Result.ok(committed);
  } catch (error) {
    if (error instanceof WorkflowStorageWriteError) {
      return Result.err(error);
    }

    if (error instanceof TransactionRollbackError) {
      return Result.ok({ kind: "race_lost" });
    }

    return Result.err(
      new WorkflowStorageWriteError({
        ...(actionId === null ? {} : { actionId }),
        cause: error,
        family: adapter.family,
        operation: "commit_command",
      })
    );
  }
}
