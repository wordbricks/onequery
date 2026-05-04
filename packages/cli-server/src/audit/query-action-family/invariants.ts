import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import { WorkflowInternalInvariantError } from "../invariant-errors";
import type { WorkflowInvariantScope } from "../invariant-errors";
import type { QueryActionSourceDescriptor } from "./descriptors";
import type { QueryActionState } from "./state";

type QueryActionInvariantContext = {
  commandType?: string;
  eventType?: string;
  scope: WorkflowInvariantScope;
};

function queryActionInvariant<T>(input: {
  context: QueryActionInvariantContext;
  invariant: string;
  phase?: string | null;
}): ResultType<T, WorkflowInternalInvariantError> {
  return Result.err(
    new WorkflowInternalInvariantError({
      ...(input.context.commandType === undefined
        ? {}
        : { commandType: input.context.commandType }),
      ...(input.context.eventType === undefined
        ? {}
        : { eventType: input.context.eventType }),
      family: "query_action",
      invariant: input.invariant,
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      scope: input.context.scope,
    })
  );
}

export function requireQueryActionState(
  state: QueryActionState | null,
  context: QueryActionInvariantContext
): ResultType<QueryActionState, WorkflowInternalInvariantError> {
  if (state === null) {
    return queryActionInvariant({
      context,
      invariant: "state_required",
      phase: null,
    });
  }

  return Result.ok(state);
}

export function requireQueryActionSourceDescriptor(
  state: Pick<QueryActionState, "phase" | "sourceDescriptor">,
  context: QueryActionInvariantContext
): ResultType<QueryActionSourceDescriptor, WorkflowInternalInvariantError> {
  if (state.sourceDescriptor === null) {
    return queryActionInvariant({
      context,
      invariant: "source_descriptor_required",
      phase: state.phase,
    });
  }

  return Result.ok(state.sourceDescriptor);
}
