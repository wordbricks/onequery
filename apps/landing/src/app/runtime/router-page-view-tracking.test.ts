import { afterEach, describe, expect, it, vi } from "vitest";

import { registerRouterPageViewTracking } from "./router-page-view-tracking";

describe("registerRouterPageViewTracking", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
      return;
    }

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("tracks each resolved page visit without suppressing a later return", () => {
    let handleResolved: (() => void) | null = null;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          pathname: "/",
          search: "",
        },
      },
    });

    const unsubscribe = vi.fn();
    const router = {
      subscribe: vi.fn((eventType: "onResolved", listener: () => void) => {
        expect(eventType).toBe("onResolved");
        handleResolved = listener;
        return unsubscribe;
      }),
    };
    const trackResolvedPageView = vi.fn();

    const stopTracking = registerRouterPageViewTracking(
      router,
      trackResolvedPageView
    );

    const emitResolved = () => {
      if (handleResolved === null) {
        throw new Error("Expected router page-view listener to be registered");
      }

      handleResolved();
    };

    emitResolved();
    emitResolved();

    globalThis.window.location.pathname = "/docs";
    emitResolved();

    globalThis.window.location.pathname = "/";
    emitResolved();

    expect(trackResolvedPageView).toHaveBeenCalledTimes(3);
    stopTracking();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
