type AnalyticsEventValue = boolean | number | string | undefined;

type AnalyticsEventParams = Record<string, AnalyticsEventValue>;
type GoogleTagEventParams = Record<string, boolean | number | string>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (
      command: "event",
      eventName: string,
      eventParams?: GoogleTagEventParams
    ) => void;
  }
}

function getDefinedEventParams(params: AnalyticsEventParams) {
  const eventParams: GoogleTagEventParams = {};

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      eventParams[key] = value;
    }
  }

  return eventParams;
}

function trackEvent(name: string, params: AnalyticsEventParams = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const eventParams = getDefinedEventParams(params);

  if (typeof window.gtag === "function") {
    window.gtag("event", name, eventParams);
    return;
  }

  window.dataLayer ??= [];
  window.dataLayer.push(["event", name, eventParams]);
}

export function trackCtaClick(
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
