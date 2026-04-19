type AnalyticsEventValue = boolean | number | string | undefined;

type AnalyticsEventParams = Record<string, AnalyticsEventValue>;

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
  }
}

const GOOGLE_TAG_MANAGER_URL = "https://www.googletagmanager.com/gtag/js";
const DEFAULT_GA_MEASUREMENT_ID = "G-TVPWK9V4TE";

const configuredMeasurementIds = new Set<string>();
const trackedPagePaths = new Set<string>();

function getMeasurementId() {
  const configuredMeasurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  if (configuredMeasurementId === undefined) {
    return DEFAULT_GA_MEASUREMENT_ID;
  }

  return configuredMeasurementId.trim();
}

function getPagePath() {
  return `${window.location.pathname}${window.location.search}`;
}

function getGtag() {
  if (typeof window === "undefined") {
    return null;
  }

  window.dataLayer ??= [];
  window.gtag ??= (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  return window.gtag;
}

function loadGoogleTagManager(measurementId: string) {
  if (typeof document === "undefined") {
    return;
  }

  const existingScript = document.querySelector<HTMLScriptElement>(
    `script[data-ga-measurement-id="${measurementId}"]`
  );
  if (existingScript) {
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `${GOOGLE_TAG_MANAGER_URL}?id=${measurementId}`;
  script.dataset.gaMeasurementId = measurementId;

  // Comment: external analytics scripts should never break the landing page if
  // a browser, test DOM, or CSP blocks the load.
  try {
    document.head.appendChild(script);
  } catch {
    // Comment: best-effort only; leave the app interactive without GA4.
  }
}

export function initializeAnalytics() {
  const measurementId = getMeasurementId();
  if (!measurementId) {
    return false;
  }

  const gtag = getGtag();
  if (!gtag) {
    return false;
  }

  loadGoogleTagManager(measurementId);

  if (configuredMeasurementIds.has(measurementId)) {
    return true;
  }

  gtag("js", new Date());
  gtag("config", measurementId, {
    send_page_view: false,
  });
  configuredMeasurementIds.add(measurementId);
  return true;
}

export function trackEvent(name: string, params: AnalyticsEventParams = {}) {
  if (!initializeAnalytics()) {
    return;
  }

  const gtag = getGtag();
  if (!gtag) {
    return;
  }

  gtag("event", name, params);
}

export function trackPageView() {
  if (typeof window === "undefined") {
    return;
  }

  const pagePath = getPagePath();

  // Comment: React StrictMode replays effects in development, so keep the
  // landing page view idempotent per path to avoid duplicate GA4 hits.
  if (trackedPagePaths.has(pagePath)) {
    return;
  }

  trackedPagePaths.add(pagePath);

  trackEvent("page_view", {
    page_location: window.location.href,
    page_path: pagePath,
    page_title: document.title,
  });
}

export function trackLandingCtaClick(
  ctaId: string,
  location: string,
  destination?: string
) {
  trackEvent("landing_cta_click", {
    cta_id: ctaId,
    destination,
    location,
  });
}

export function trackInstallCommandCopied(method: string) {
  trackEvent("landing_install_command_copied", {
    method,
  });
}

export function trackInstallMethodSelected(method: string) {
  trackEvent("landing_install_method_selected", {
    method,
  });
}

export function trackProductUpdatesSignup() {
  trackEvent("sign_up", {
    method: "product_updates",
  });
}

export function trackContactModalOpened() {
  trackEvent("landing_contact_opened", {
    location: "footer",
  });
}

export function trackContactFormSubmitted() {
  trackEvent("generate_lead", {
    form_id: "contact",
    location: "footer_modal",
  });
}

export function resetAnalyticsStateForTests() {
  configuredMeasurementIds.clear();
  trackedPagePaths.clear();
}
