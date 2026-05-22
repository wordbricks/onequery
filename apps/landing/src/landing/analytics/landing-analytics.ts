import { readGoogleTagManagerConfig } from "./google-tag-manager-config";
import { landingAnalyticsEnv } from "./landing-analytics-env";

type AnalyticsEventValue = boolean | number | string | undefined;

type AnalyticsEventParams = Record<string, AnalyticsEventValue>;
type DataLayerEvent = Record<string, boolean | number | string>;
type DataLayerEntry = DataLayerEvent | unknown[];

declare global {
  interface Window {
    dataLayer?: DataLayerEntry[];
  }
}

const googleTagManagerConfig = readGoogleTagManagerConfig(landingAnalyticsEnv);

function getDefinedEventParams(params: AnalyticsEventParams) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined)
  ) as Record<string, boolean | number | string>;
}

function pushDataLayerEvent(name: string, params: AnalyticsEventParams) {
  if (typeof window === "undefined") {
    return false;
  }

  window.dataLayer ??= [];
  window.dataLayer.push({
    event: name,
    ...getDefinedEventParams(params),
  });
  return true;
}

function trackEvent(name: string, params: AnalyticsEventParams = {}) {
  if (!googleTagManagerConfig) {
    return;
  }

  pushDataLayerEvent(name, params);
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
