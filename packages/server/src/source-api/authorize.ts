import { SourceApiPermissionDeniedError } from "./errors";
import type { NormalizedExecutionPlan, SourceApiActorContext } from "./types";

export const SOURCE_API_ACTIONS = {
  describe: "source_api.describe",
  execute: "source_api.execute",
} as const;

export function canActorAccessSourceApi(input: {
  actor: SourceApiActorContext;
  action: (typeof SOURCE_API_ACTIONS)[keyof typeof SOURCE_API_ACTIONS];
}): boolean {
  return input.actor.capabilities.includes(input.action);
}

export async function authorizeSourceApi(input: {
  plan: NormalizedExecutionPlan;
  actor: SourceApiActorContext;
}): Promise<void> {
  if (
    !canActorAccessSourceApi({
      action: SOURCE_API_ACTIONS.execute,
      actor: input.actor,
    })
  ) {
    throw new SourceApiPermissionDeniedError({
      operation: input.plan.operation,
      userId: input.actor.userId,
    });
  }
}
