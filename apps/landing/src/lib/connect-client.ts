import { createConnectTransport } from "@connectrpc/connect-web";

import { LANDING_CONNECT_PATH_PREFIX } from "../landing-api";

function resolveBaseUrl() {
  const configuredBaseUrl =
    import.meta.env.VITE_LANDING_API_BASE_URL?.trim() ?? "";
  if (configuredBaseUrl.length > 0) {
    return new URL(LANDING_CONNECT_PATH_PREFIX, configuredBaseUrl).toString();
  }
  return LANDING_CONNECT_PATH_PREFIX;
}

export const landingTransport = createConnectTransport({
  baseUrl: resolveBaseUrl(),
});
