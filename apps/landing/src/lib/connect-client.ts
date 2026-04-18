import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

import { LandingService } from "../connect/gen/onequery/landing/v1/landing_pb.js";

const LANDING_API_PATH = "/api" as const;

function resolveBaseUrl() {
  const configuredBaseUrl =
    import.meta.env.VITE_LANDING_API_BASE_URL?.trim() ?? "";
  if (configuredBaseUrl.length > 0) {
    return new URL(LANDING_API_PATH, configuredBaseUrl).toString();
  }
  // Comment: a relative baseUrl keeps the browser on the same origin that
  // serves the SPA, matching the Worker's `/api/*` mount.
  return LANDING_API_PATH;
}

export const landingTransport = createConnectTransport({
  baseUrl: resolveBaseUrl(),
});

export const landingClient = createClient(LandingService, landingTransport);
