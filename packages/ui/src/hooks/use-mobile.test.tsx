import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsMobile } from "./use-mobile";

type MatchMediaControllerOptions = {
  legacyListenersOnly?: boolean;
  matches?: boolean;
};

function createMatchMediaController(options: MatchMediaControllerOptions = {}) {
  let matches = options.matches ?? false;
  const listeners = new Set<() => void>();
  const addEventListener = options.legacyListenersOnly
    ? undefined
    : (_type: string, listener: () => void) => {
        listeners.add(listener);
      };
  const removeEventListener = options.legacyListenersOnly
    ? undefined
    : (_type: string, listener: () => void) => {
        listeners.delete(listener);
      };

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: "(max-width: 767px)",
    onchange: null,
    addEventListener,
    removeEventListener,
    addListener(listener: () => void) {
      listeners.add(listener);
    },
    removeListener(listener: () => void) {
      listeners.delete(listener);
    },
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;

  return {
    mediaQueryList,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      for (const listener of listeners) {
        listener();
      }
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function MobileProbe() {
  return <div data-mobile={useIsMobile() ? "true" : "false"} />;
}

let originalMatchMedia: typeof window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

describe("useIsMobile", () => {
  it("tracks mobile state from MediaQueryList.matches", async () => {
    originalMatchMedia = window.matchMedia;
    const controller = createMatchMediaController({ matches: false });
    window.matchMedia = vi.fn(() => controller.mediaQueryList);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<MobileProbe />);
    });

    expect(container.firstElementChild?.getAttribute("data-mobile")).toBe(
      "false"
    );

    await act(async () => {
      controller.setMatches(true);
    });

    expect(container.firstElementChild?.getAttribute("data-mobile")).toBe(
      "true"
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to legacy MediaQueryList listeners and cleans them up", async () => {
    originalMatchMedia = window.matchMedia;
    const controller = createMatchMediaController({
      legacyListenersOnly: true,
      matches: true,
    });
    window.matchMedia = vi.fn(() => controller.mediaQueryList);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<MobileProbe />);
    });

    expect(controller.listenerCount).toBe(1);
    expect(container.firstElementChild?.getAttribute("data-mobile")).toBe(
      "true"
    );

    await act(async () => {
      root.unmount();
    });

    expect(controller.listenerCount).toBe(0);
  });
});
