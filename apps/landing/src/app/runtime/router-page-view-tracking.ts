import { trackPageView } from "../../landing/analytics/landing-analytics";

type RouterPageViewTracker = {
  subscribe: (eventType: "onResolved", listener: () => void) => () => void;
};

function getCurrentPageKey() {
  return `${window.location.pathname}${window.location.search}`;
}

export function registerRouterPageViewTracking(
  router: RouterPageViewTracker,
  trackResolvedPageView: () => void = trackPageView
) {
  if (typeof window === "undefined") {
    return () => {};
  }

  let lastTrackedPageKey: string | null = null;

  return router.subscribe("onResolved", () => {
    const nextPageKey = getCurrentPageKey();

    if (nextPageKey === lastTrackedPageKey) {
      return;
    }

    // Comment: subscribe at the router boundary so pageviews follow resolved
    // navigations while hash-only repeats stay silent.
    lastTrackedPageKey = nextPageKey;
    trackResolvedPageView();
  });
}
