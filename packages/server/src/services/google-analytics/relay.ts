import type { GoogleAnalyticsCredentials } from "@onequery/db/server";

import { getServiceAccountAccessToken } from "../oauth/service-account-token";
import { DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS } from "../provider-http";
import { hasControlCharacters } from "../provider-utils";

const GA_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const GA_DATA_API_BASE_URL = "https://analyticsdata.googleapis.com";
const MAX_PROPERTY_SEGMENT_LENGTH = 128;

type GaRelayMethod = "run_report" | "run_realtime_report";

function normalizePropertyPath(propertyIdOrPath: string): string | null {
  const trimmed = propertyIdOrPath.trim();
  if (trimmed.length === 0 || hasControlCharacters(trimmed)) {
    return null;
  }

  const propertyId = trimmed.startsWith("properties/")
    ? trimmed.slice("properties/".length)
    : trimmed;
  if (
    propertyId.length === 0 ||
    propertyId.length > MAX_PROPERTY_SEGMENT_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(propertyId)
  ) {
    return null;
  }

  return `properties/${propertyId}`;
}

function requirePropertyPath(propertyPath: string): string {
  const normalized = normalizePropertyPath(propertyPath);
  if (!normalized) {
    throw new Error(
      "Google Analytics property must be a property ID or properties/<id>"
    );
  }
  return normalized;
}

function requireAccessToken(accessToken: string): string {
  const normalized = accessToken.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new Error("Google Analytics access token is required");
  }
  return normalized;
}

export function resolveGoogleAnalyticsPropertyPath(input: {
  request: Record<string, unknown>;
  credentials: GoogleAnalyticsCredentials;
}): string | null {
  const requestProperty =
    typeof input.request.property === "string" ? input.request.property : null;
  if (requestProperty && requestProperty.trim().length > 0) {
    return normalizePropertyPath(requestProperty);
  }
  const credentialsProperty = input.credentials.propertyId;
  if (!credentialsProperty || credentialsProperty.trim().length === 0) {
    return null;
  }
  return normalizePropertyPath(credentialsProperty);
}

function getOperationName(
  method: GaRelayMethod
): "runReport" | "runRealtimeReport" {
  if (method === "run_report") {
    return "runReport";
  }
  return "runRealtimeReport";
}

export async function resolveGoogleAnalyticsAccessToken(input: {
  credentials: GoogleAnalyticsCredentials;
}): Promise<{
  accessToken: string;
}> {
  if (input.credentials.authType === "service_account") {
    const serviceAccount = input.credentials.serviceAccount;
    const accessToken = await getServiceAccountAccessToken({
      clientEmail: serviceAccount.clientEmail,
      privateKey: serviceAccount.privateKey,
      scope: GA_READONLY_SCOPE,
    });
    return { accessToken: requireAccessToken(accessToken) };
  }
  return { accessToken: requireAccessToken(input.credentials.accessToken) };
}

export async function runGoogleAnalyticsDataRequest(input: {
  method: GaRelayMethod;
  propertyPath: string;
  requestBody: Record<string, unknown>;
  accessToken: string;
}): Promise<Response> {
  const propertyPath = requirePropertyPath(input.propertyPath);
  const accessToken = requireAccessToken(input.accessToken);
  const endpoint = new URL(
    `/v1beta/${propertyPath}:${getOperationName(input.method)}`,
    `${GA_DATA_API_BASE_URL}/`
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
  );

  return fetch(endpoint, {
    body: JSON.stringify(input.requestBody),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: controller.signal,
  })
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Google Analytics request timeout after ${DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS}ms`,
          {
            cause: error,
          }
        );
      }
      throw error;
    })
    .finally(() => {
      clearTimeout(timeoutId);
    });
}
