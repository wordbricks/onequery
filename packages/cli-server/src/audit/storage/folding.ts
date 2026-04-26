import { ulid } from "@onequery/db/server";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import { WorkflowInternalInvariantError } from "../invariant-errors";
import type { WorkflowCommittedEvent, WorkflowFamily } from "../kernel";
import { WorkflowStorageCorruptRowError } from "./errors";
import type { WorkflowActionRepairAnchor } from "./types";

export function buildCommittedEvents<Event extends { type: string }>(input: {
  events: readonly [Event, ...Event[]];
  occurredAt: Date;
  startingSequence: number;
}) {
  return input.events.map(
    (event, index) =>
      ({
        ...event,
        id: ulid(),
        occurredAt: input.occurredAt,
        sequence: input.startingSequence + index + 1,
      }) as WorkflowCommittedEvent<Event>
  );
}

export function foldCommittedEvents<
  State,
  Event extends { type: string },
>(input: {
  events: readonly WorkflowCommittedEvent<Event>[];
  initialState: State | null;
  reduce: (
    state: State | null,
    event: WorkflowCommittedEvent<Event>
  ) => ResultType<State, WorkflowInternalInvariantError>;
}): ResultType<State | null, WorkflowInternalInvariantError> {
  let currentState = input.initialState;

  for (const event of input.events) {
    const nextState = input.reduce(currentState, event);
    if (nextState.isErr()) {
      return Result.err(nextState.error);
    }
    currentState = nextState.value;
  }

  return Result.ok(currentState);
}

export function requireStoredAcceptedActionId(input: {
  actionId: string | null;
  commandId: string;
  family: WorkflowFamily;
}): ResultType<string, WorkflowStorageCorruptRowError> {
  if (input.actionId === null) {
    return Result.err(
      new WorkflowStorageCorruptRowError({
        commandId: input.commandId,
        entity: "workflow_command_action_id",
        family: input.family,
      })
    );
  }

  return Result.ok(input.actionId);
}

export function requireAcceptedActionId(input: {
  actionId: string | null;
  commandType: string;
  family: WorkflowFamily;
}): ResultType<string, WorkflowInternalInvariantError> {
  if (input.actionId === null) {
    return Result.err(
      new WorkflowInternalInvariantError({
        commandType: input.commandType,
        family: input.family,
        invariant: "accepted_action_id_required",
        scope: "storage",
      })
    );
  }

  return Result.ok(input.actionId);
}

export function requireFoldedState<State>(input: {
  commandType?: string;
  entity: string;
  family: WorkflowFamily;
  state: State | null;
}): ResultType<State, WorkflowInternalInvariantError> {
  if (input.state === null) {
    return Result.err(
      new WorkflowInternalInvariantError({
        ...(input.commandType === undefined
          ? {}
          : { commandType: input.commandType }),
        entity: input.entity,
        family: input.family,
        invariant: "folded_state_required",
        scope: "storage",
      })
    );
  }

  return Result.ok(input.state);
}

export function hasMatchingRepairAnchor(
  state: Pick<WorkflowActionRepairAnchor, "lastEventId" | "lastEventSequence">,
  repairAnchor: WorkflowActionRepairAnchor | null
) {
  return (
    repairAnchor !== null &&
    state.lastEventId === repairAnchor.lastEventId &&
    state.lastEventSequence === repairAnchor.lastEventSequence
  );
}
