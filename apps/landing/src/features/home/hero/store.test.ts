import { describe, expect, it, vi } from "vitest";

import {
  HERO_TAB_DWELL_MS,
  SAFE_QUERY_INITIAL_DELAY_MS,
  SAFE_QUERY_RESULT_HOLD_MS,
  SAFE_QUERY_STEP_DELAY_MS,
  createHeroProductStore,
  readActiveHeroProductTab,
  readSafeQueryAnimationState,
} from "./store";

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("createHeroProductStore", () => {
  it("cycles query checks through pass and blocked scenarios before advancing tabs", async () => {
    vi.useFakeTimers();

    const heroProductStore = createHeroProductStore();
    const unmountStore = heroProductStore.$heroProductState.listen(() => {});

    try {
      expect(
        readActiveHeroProductTab(heroProductStore.$heroProductState.get())
      ).toBe("integrations");

      await advanceTimersByTime(HERO_TAB_DWELL_MS.integrations);

      expect(
        readActiveHeroProductTab(heroProductStore.$heroProductState.get())
      ).toBe("query");

      await advanceTimersByTime(
        SAFE_QUERY_INITIAL_DELAY_MS + SAFE_QUERY_STEP_DELAY_MS * 2
      );

      expect(
        readSafeQueryAnimationState(heroProductStore.$heroProductState.get())
          .result
      ).toBe("pass");

      await advanceTimersByTime(SAFE_QUERY_RESULT_HOLD_MS);

      expect(
        readSafeQueryAnimationState(heroProductStore.$heroProductState.get())
          .cycleIndex
      ).toBe(1);

      await advanceTimersByTime(
        SAFE_QUERY_INITIAL_DELAY_MS + SAFE_QUERY_STEP_DELAY_MS
      );

      expect(
        readSafeQueryAnimationState(heroProductStore.$heroProductState.get())
          .result
      ).toBe("blocked");

      await advanceTimersByTime(
        HERO_TAB_DWELL_MS.query -
          (SAFE_QUERY_INITIAL_DELAY_MS * 2 +
            SAFE_QUERY_STEP_DELAY_MS * 3 +
            SAFE_QUERY_RESULT_HOLD_MS)
      );

      expect(
        readActiveHeroProductTab(heroProductStore.$heroProductState.get())
      ).toBe("audit");
    } finally {
      unmountStore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
