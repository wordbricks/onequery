import { createConnectTransport } from "@connectrpc/connect-web";

const LANDING_API_PATH = "/api" as const;

function resolveBaseUrl() {
  const configuredBaseUrl =
    import.meta.env.VITE_LANDING_API_BASE_URL?.trim() ?? "";
  if (configuredBaseUrl.length > 0) {
    return new URL(LANDING_API_PATH, configuredBaseUrl).toString();
  }
  return LANDING_API_PATH;
}

export const landingTransport = createConnectTransport({
  baseUrl: resolveBaseUrl(),
});
