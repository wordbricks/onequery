// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initializeAnalytics,
  resetAnalyticsStateForTests,
  trackEvent,
  trackPageView,
} from "./analytics";

describe("landing analytics", () => {
  const originalHeadAppend = document.head.append.bind(document.head);

  beforeEach(() => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST1234");
    resetAnalyticsStateForTests();
    document.head.innerHTML = "";
    document.title = "OneQuery Landing";
    window.dataLayer = [];
    window.gtag = undefined;
    window.history.replaceState({}, "", "/");
    document.head.append = ((...nodes: (Node | string)[]) => {
      for (const node of nodes) {
        if (node instanceof HTMLScriptElement) {
          node.type = "text/plain";
        }
      }

      return originalHeadAppend(...nodes);
    }) as typeof document.head.append;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAnalyticsStateForTests();
    document.head.innerHTML = "";
    window.dataLayer = [];
    window.gtag = undefined;
    document.head.append = originalHeadAppend;
  });

  it("injects and configures the GA4 tag once", () => {
    expect(initializeAnalytics()).toBe(true);
    expect(initializeAnalytics()).toBe(true);

    const scripts = document.head.querySelectorAll(
      'script[data-ga-measurement-id="G-TEST1234"]'
    );

    expect(scripts).toHaveLength(1);
    expect(window.dataLayer).toHaveLength(2);
    expect(window.dataLayer?.[0]?.[0]).toBe("js");
    expect(window.dataLayer?.[1]).toEqual([
      "config",
      "G-TEST1234",
      { send_page_view: false },
    ]);
  });

  it("deduplicates the initial page view per path", () => {
    trackPageView();
    trackPageView();

    expect(window.dataLayer).toContainEqual([
      "event",
      "page_view",
      {
        page_location: "http://localhost:3000/",
        page_path: "/",
        page_title: "OneQuery Landing",
      },
    ]);

    const pageViewEvents =
      window.dataLayer?.filter(
        (entry) => entry[0] === "event" && entry[1] === "page_view"
      ) ?? [];

    expect(pageViewEvents).toHaveLength(1);
  });

  it("does nothing when the measurement id is not configured", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
    resetAnalyticsStateForTests();

    trackEvent("landing_cta_click", { cta_id: "hero_get_started" });

    expect(document.head.querySelector("script")).toBeNull();
    expect(window.dataLayer).toEqual([]);
  });
});
