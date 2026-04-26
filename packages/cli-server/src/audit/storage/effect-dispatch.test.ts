import { describe, expect, it } from "vitest";

import { insertWorkflowEffectDispatches } from "./effect-dispatch";

type CapturedDispatch = {
  effectKey: string;
  effectType: string;
  payloadBytes: Buffer;
};

function createCapturingTransaction(captured: CapturedDispatch[]) {
  return {
    insert() {
      return {
        async values(values: CapturedDispatch[]) {
          captured.push(...values);
        },
      };
    },
  };
}

describe("workflow effect dispatch storage", () => {
  it("derives effect keys from scalar workflow position, not protobuf bytes", async () => {
    const occurredAt = new Date("2026-04-25T00:00:00.000Z");
    const effect = {
      organizationId: "org_1",
      sourceKey: "warehouse",
      type: "load_source",
    };
    const firstDispatches: CapturedDispatch[] = [];
    const secondDispatches: CapturedDispatch[] = [];

    await insertWorkflowEffectDispatches({
      actionId: "query_action_1",
      encodeEffectPayload: () => Buffer.from([1]),
      effects: [effect],
      family: "query_action",
      occurredAt,
      originEventId: "event_1",
      tx: createCapturingTransaction(firstDispatches) as never,
    });
    await insertWorkflowEffectDispatches({
      actionId: "query_action_1",
      encodeEffectPayload: () => Buffer.from([2, 3]),
      effects: [effect],
      family: "query_action",
      occurredAt,
      originEventId: "event_1",
      tx: createCapturingTransaction(secondDispatches) as never,
    });

    expect(firstDispatches).toHaveLength(1);
    expect(secondDispatches).toHaveLength(1);
    expect(firstDispatches[0]?.payloadBytes.equals(Buffer.from([1]))).toBe(
      true
    );
    expect(secondDispatches[0]?.payloadBytes.equals(Buffer.from([2, 3]))).toBe(
      true
    );
    expect(firstDispatches[0]?.effectKey).toBe("query_action:event_1:1");
    expect(secondDispatches[0]?.effectKey).toBe(firstDispatches[0]?.effectKey);
    expect(firstDispatches[0]?.effectType).toBe("load_source");
  });
});
