import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import { WorkflowInternalInvariantError } from "../invariant-errors";
import type { WorkflowInvariantScope } from "../invariant-errors";
import type {
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
} from "./descriptors";
import type { SourceApiActionState } from "./state";

type SourceApiActionInvariantContext = {
  commandType?: string;
  eventType?: string;
  scope: WorkflowInvariantScope;
};

function sourceApiActionInvariant<T>(input: {
  context: SourceApiActionInvariantContext;
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
      family: "source_api_action",
      invariant: input.invariant,
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      scope: input.context.scope,
    })
  );
}

export function requireSourceApiActionState(
  state: SourceApiActionState | null,
  context: SourceApiActionInvariantContext
): ResultType<SourceApiActionState, WorkflowInternalInvariantError> {
  if (state === null) {
    return sourceApiActionInvariant({
      context,
      invariant: "state_required",
      phase: null,
    });
  }

  return Result.ok(state);
}

export function requireSourceApiActionSourceDescriptor(
  state: Pick<SourceApiActionState, "phase" | "sourceDescriptor">,
  context: SourceApiActionInvariantContext
): ResultType<SourceApiActionSourceDescriptor, WorkflowInternalInvariantError> {
  if (state.sourceDescriptor === null) {
    return sourceApiActionInvariant({
      context,
      invariant: "source_descriptor_required",
      phase: state.phase,
    });
  }

  return Result.ok(state.sourceDescriptor);
}

export function requireSourceApiActionRequestDescriptor(
  state: Pick<SourceApiActionState, "phase" | "requestDescriptor">,
  context: SourceApiActionInvariantContext
): ResultType<
  SourceApiActionRequestDescriptor,
  WorkflowInternalInvariantError
> {
  if (state.requestDescriptor === null) {
    return sourceApiActionInvariant({
      context,
      invariant: "request_descriptor_required",
      phase: state.phase,
    });
  }

  return Result.ok(state.requestDescriptor);
}
