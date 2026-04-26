import { and, eq, workflowCommands } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { Result } from "better-result";

import type { WorkflowFamily, WorkflowStateBase } from "../kernel";
import {
  WorkflowStorageCorruptRowError,
  WorkflowStorageReadError,
} from "./errors";
import type { WorkflowStorageError } from "./errors";
import {
  foldCommittedEvents,
  hasMatchingRepairAnchor,
  requireFoldedState,
  requireStoredAcceptedActionId,
} from "./folding";
import { parseStoredSharedRejectCode } from "./serialization";
import type {
  StoredAcceptedWorkflowDecision,
  StoredRejectedWorkflowDecision,
  StoredWorkflowDecisionCore,
  WorkflowActionRepairAnchor,
  WorkflowStoreAdapter,
} from "./types";

function readError(input: {
  cause: unknown;
  family: WorkflowFamily;
  operation: string;
}) {
  return new WorkflowStorageReadError(input);
}

function corruptHistoryError(input: {
  actionId: string;
  cause: unknown;
  family: WorkflowFamily;
  repairAnchor: WorkflowActionRepairAnchor | null;
}) {
  return new WorkflowStorageCorruptRowError({
    actionId: input.actionId,
    cause: input.cause,
    entity: "workflow_event_history",
    family: input.family,
    repairAnchor: input.repairAnchor,
  });
}

export async function loadStoredWorkflowDecision<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  commandInvocationId: string;
  db: Database;
}): Promise<
  Result<
    StoredWorkflowDecisionCore<Family, Event, RejectCode> | null,
    WorkflowStorageError
  >
> {
  const storedCommand = await Result.tryPromise({
    catch: (cause) =>
      readError({
        cause,
        family: input.adapter.family,
        operation: "load_command_journal",
      }),
    try: () =>
      input.db.query.workflowCommands.findFirst({
        where: and(
          eq(workflowCommands.family, input.adapter.family),
          eq(workflowCommands.commandInvocationId, input.commandInvocationId)
        ),
      }),
  });

  if (storedCommand.isErr()) {
    return Result.err(storedCommand.error);
  }

  const commandRow = storedCommand.value;
  if (commandRow === undefined) {
    return Result.ok(null);
  }

  if (commandRow.decisionKind === "rejected") {
    const rejectCode = parseStoredSharedRejectCode(
      input.adapter.family,
      commandRow.rejectCode
    );
    if (rejectCode.isErr()) {
      return Result.err(rejectCode.error);
    }

    return Result.ok({
      actionId: commandRow.actionId,
      commandId: commandRow.id,
      family: input.adapter.family,
      kind: "rejected",
      rejectCode: rejectCode.value as RejectCode,
      ...(commandRow.rejectDetail === null
        ? {}
        : { rejectDetail: commandRow.rejectDetail }),
    } satisfies StoredRejectedWorkflowDecision<Family, RejectCode>);
  }

  const events = await Result.tryPromise({
    catch: (cause) =>
      readError({
        cause,
        family: input.adapter.family,
        operation: "load_command_events",
      }),
    try: () => input.adapter.loadEventsByCommandId(input.db, commandRow.id),
  });
  if (events.isErr()) {
    return Result.err(events.error);
  }
  if (events.value.isErr()) {
    return Result.err(events.value.error);
  }

  const actionId = requireStoredAcceptedActionId({
    actionId: commandRow.actionId,
    commandId: commandRow.id,
    family: input.adapter.family,
  });
  if (actionId.isErr()) {
    return Result.err(actionId.error);
  }

  return Result.ok({
    actionId: actionId.value,
    commandId: commandRow.id,
    events: events.value.value,
    family: input.adapter.family,
    kind: "accepted",
  } satisfies StoredAcceptedWorkflowDecision<Family, Event>);
}

export async function loadWorkflowState<
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
  db: Database;
}): Promise<Result<State | null, WorkflowStorageError>> {
  if (input.actionId === null) {
    return Result.ok(null);
  }
  const actionId = input.actionId;

  let repairAnchor: WorkflowActionRepairAnchor | null = null;
  const loadedState = await Result.tryPromise({
    catch: (cause) =>
      readError({
        cause,
        family: input.adapter.family,
        operation: "load_action_state",
      }),
    try: () => input.adapter.loadState(input.db, actionId),
  });

  if (loadedState.isErr()) {
    return Result.err(loadedState.error);
  }

  if (loadedState.value.isErr()) {
    repairAnchor = loadedState.value.error.repairAnchor ?? null;
  } else if (loadedState.value.value !== null) {
    const latestEventPointer = await Result.tryPromise({
      catch: (cause) =>
        readError({
          cause,
          family: input.adapter.family,
          operation: "load_latest_event_pointer",
        }),
      try: () => input.adapter.loadLatestEventPointer(input.db, actionId),
    });
    if (latestEventPointer.isErr()) {
      return Result.err(latestEventPointer.error);
    }

    if (
      hasMatchingRepairAnchor(loadedState.value.value, latestEventPointer.value)
    ) {
      return Result.ok(loadedState.value.value);
    }

    repairAnchor = {
      lastEventId: loadedState.value.value.lastEventId,
      lastEventSequence: loadedState.value.value.lastEventSequence,
    };
  }

  return rebuildWorkflowState({
    actionId,
    adapter: input.adapter,
    db: input.db,
    repairAnchor,
  });
}

async function rebuildWorkflowState<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  actionId: string;
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  db: Database;
  repairAnchor: WorkflowActionRepairAnchor | null;
}): Promise<Result<State | null, WorkflowStorageError>> {
  const history = await Result.tryPromise({
    catch: (cause) =>
      readError({
        cause,
        family: input.adapter.family,
        operation: "rebuild_action_state",
      }),
    try: () => input.adapter.loadHistoryByActionId(input.db, input.actionId),
  });
  if (history.isErr()) {
    return Result.err(history.error);
  }
  if (history.value.isErr()) {
    return Result.err(history.value.error);
  }
  if (history.value.value === null) {
    return Result.ok(null);
  }
  const actionHistory = history.value.value;

  const rebuilt = foldCommittedEvents({
    events: actionHistory.events,
    initialState: null,
    reduce: input.adapter.reduce,
  });
  if (rebuilt.isErr()) {
    return Result.err(
      corruptHistoryError({
        actionId: input.actionId,
        cause: rebuilt.error,
        family: input.adapter.family,
        repairAnchor: input.repairAnchor,
      })
    );
  }

  const rebuiltState = requireFoldedState({
    entity: "workflow_event_history",
    family: input.adapter.family,
    state: rebuilt.value,
  });
  if (rebuiltState.isErr()) {
    return Result.err(
      corruptHistoryError({
        actionId: input.actionId,
        cause: rebuiltState.error,
        family: input.adapter.family,
        repairAnchor: input.repairAnchor,
      })
    );
  }

  const repaired = await Result.tryPromise({
    catch: (cause) =>
      readError({
        cause,
        family: input.adapter.family,
        operation: "repair_action_state",
      }),
    try: () =>
      input.db.transaction((tx) =>
        input.adapter.repairAction({
          actionId: input.actionId,
          organizationId: actionHistory.organizationId,
          repairAnchor: input.repairAnchor,
          state: rebuiltState.value,
          tx,
        })
      ),
  });
  if (repaired.isErr()) {
    return Result.err(repaired.error);
  }

  if (repaired.value) {
    return Result.ok(rebuiltState.value);
  }

  const reloadedState = await Result.tryPromise({
    catch: (cause) =>
      readError({
        cause,
        family: input.adapter.family,
        operation: "reload_repaired_action_state",
      }),
    try: () => input.adapter.loadState(input.db, input.actionId),
  });
  if (reloadedState.isErr()) {
    return Result.err(reloadedState.error);
  }

  if (reloadedState.value.isErr()) {
    return Result.err(reloadedState.value.error);
  }

  return Result.ok(reloadedState.value.value);
}
