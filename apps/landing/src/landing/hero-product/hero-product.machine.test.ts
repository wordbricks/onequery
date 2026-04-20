import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import {
  HERO_TAB_DWELL_MS,
  SAFE_QUERY_INITIAL_DELAY_MS,
  SAFE_QUERY_RESULT_HOLD_MS,
  SAFE_QUERY_STEP_DELAY_MS,
  heroProductMachine,
  readActiveHeroProductTab,
  readSafeQueryAnimationState,
} from "./hero-product.machine";

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("heroProductMachine", () => {
  it("cycles query checks through pass and blocked scenarios before advancing tabs", async () => {
    vi.useFakeTimers();

    const actor = createActor(heroProductMachine);

    actor.start();

    expect(readActiveHeroProductTab(actor.getSnapshot())).toBe("integrations");

    await advanceTimersByTime(HERO_TAB_DWELL_MS.integrations);

    expect(readActiveHeroProductTab(actor.getSnapshot())).toBe("query");

    await advanceTimersByTime(
      SAFE_QUERY_INITIAL_DELAY_MS + SAFE_QUERY_STEP_DELAY_MS * 2
    );

    expect(readSafeQueryAnimationState(actor.getSnapshot()).result).toBe(
      "pass"
    );
    expect(actor.getSnapshot().matches({ query: "passed" })).toBe(true);

    await advanceTimersByTime(SAFE_QUERY_RESULT_HOLD_MS);

    expect(readSafeQueryAnimationState(actor.getSnapshot()).cycleIndex).toBe(1);
    expect(actor.getSnapshot().matches({ query: "initialDelay" })).toBe(true);

    await advanceTimersByTime(
      SAFE_QUERY_INITIAL_DELAY_MS + SAFE_QUERY_STEP_DELAY_MS
    );

    expect(readSafeQueryAnimationState(actor.getSnapshot()).result).toBe(
      "blocked"
    );
    expect(actor.getSnapshot().matches({ query: "blocked" })).toBe(true);

    await advanceTimersByTime(
      HERO_TAB_DWELL_MS.query -
        (SAFE_QUERY_INITIAL_DELAY_MS * 2 +
          SAFE_QUERY_STEP_DELAY_MS * 3 +
          SAFE_QUERY_RESULT_HOLD_MS)
    );

    expect(readActiveHeroProductTab(actor.getSnapshot())).toBe("audit");

    vi.useRealTimers();
  });
});
