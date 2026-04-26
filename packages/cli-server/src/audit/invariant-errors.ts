import { TaggedError } from "better-result";

import type { WorkflowFamily } from "./kernel";

export type WorkflowInvariantScope = "decision" | "reducer" | "storage";

export class WorkflowInternalInvariantError extends TaggedError(
  "WorkflowInternalInvariantError"
)<{
  actionId?: string;
  commandType?: string;
  entity?: string;
  eventType?: string;
  family: WorkflowFamily;
  invariant: string;
  message: string;
  phase?: string | null;
  scope: WorkflowInvariantScope;
}>() {
  constructor(input: {
    actionId?: string;
    commandType?: string;
    entity?: string;
    eventType?: string;
    family: WorkflowFamily;
    invariant: string;
    phase?: string | null;
    scope: WorkflowInvariantScope;
  }) {
    super({
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      ...(input.commandType === undefined
        ? {}
        : { commandType: input.commandType }),
      ...(input.entity === undefined ? {} : { entity: input.entity }),
      ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
      family: input.family,
      invariant: input.invariant,
      message: `workflow internal invariant failed during ${input.scope} for ${input.family}: ${input.invariant}`,
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      scope: input.scope,
    });
  }
}
