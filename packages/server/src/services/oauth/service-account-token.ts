import { importPKCS8, SignJWT } from "jose";

import {
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
} from "../provider-http";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SERVICE_ACCOUNT_TOKEN_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:jwt-bearer";

function requireNonEmptyField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function parseGoogleTokenErrorDetail(errorText: string): string {
  const trimmed = errorText.trim();
  if (trimmed.length === 0) {
    return "Unknown error";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "error_description" in parsed &&
      typeof parsed.error_description === "string" &&
      parsed.error_description.trim().length > 0
    ) {
      return parsed.error_description
        .trim()
        .slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string" &&
      parsed.error.trim().length > 0
    ) {
      return parsed.error.trim().slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
    }
  } catch {
    // Fall back to raw text when the response is not JSON.
  }

  return trimmed.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

async function buildJwtAssertion(input: {
  clientEmail: string;
  privateKey: string;
  scope: string;
}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(
    requireNonEmptyField(input.privateKey, "privateKey"),
    "RS256"
  );

  return new SignJWT({ scope: requireNonEmptyField(input.scope, "scope") })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(requireNonEmptyField(input.clientEmail, "clientEmail"))
    .setAudience(GOOGLE_TOKEN_ENDPOINT)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 3600)
    .sign(privateKey);
}

export async function getServiceAccountAccessToken(input: {
  clientEmail: string;
  privateKey: string;
  scope: string;
}): Promise<string> {
  const assertion = await buildJwtAssertion(input);
  const body = new URLSearchParams({
    assertion,
    grant_type: SERVICE_ACCOUNT_TOKEN_GRANT_TYPE,
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
  );
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    body: body.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal: controller.signal,
  })
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Service account token request timed out after ${DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS}ms`,
          { cause: error }
        );
      }
      throw error;
    })
    .finally(() => {
      clearTimeout(timeoutId);
    });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Failed to exchange service account token: ${response.status} ${parseGoogleTokenErrorDetail(errorText)}`
    );
  }
  const tokenResult = await response
    .json()
    .then((value) => ({ ok: true as const, value }))
    .catch((error: unknown) => ({ error, ok: false as const }));
  if (!tokenResult.ok) {
    const message =
      tokenResult.error instanceof Error
        ? tokenResult.error.message
        : String(tokenResult.error);
    throw new Error(
      `Failed to parse service account token response: ${message}`
    );
  }
  const accessToken =
    typeof tokenResult.value === "object" &&
    tokenResult.value !== null &&
    "access_token" in tokenResult.value &&
    typeof tokenResult.value.access_token === "string"
      ? tokenResult.value.access_token.trim()
      : null;
  if (!accessToken) {
    throw new Error(
      "Service account token response did not include access_token"
    );
  }
  return accessToken;
}
