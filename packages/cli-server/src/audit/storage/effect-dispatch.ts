import { workflowEffectDispatches } from "@onequery/db/server";

import type { WorkflowFamily } from "../kernel";
import { toWorkflowPayloadJson } from "./serialization";
import type { DatabaseTransaction } from "./types";

export async function insertWorkflowEffectDispatches(input: {
  actionId: string;
  effects: readonly { type: string }[];
  family: WorkflowFamily;
  occurredAt: Date;
  originEventId: string;
  tx: DatabaseTransaction;
}) {
  if (input.effects.length === 0) {
    return;
  }

  // Comment: when a command emits multiple effects, they all anchor to the
  // last committed event in that command batch because that event is the latest
  // legality pointer a follow-up internal command must match.
  await input.tx.insert(workflowEffectDispatches).values(
    input.effects.map((effect, index) => ({
      actionId: input.actionId,
      attemptCount: 0,
      availableAt: input.occurredAt,
      createdAt: input.occurredAt,
      effectKey: `${input.family}:${input.originEventId}:${index + 1}`,
      effectType: effect.type,
      family: input.family,
      originEventId: input.originEventId,
      payloadJson: toWorkflowPayloadJson(effect),
      status: "pending" as const,
    }))
  );
}
