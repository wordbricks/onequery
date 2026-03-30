import type { SentryCredentials } from "@onequery/db/server";

import {
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
  normalizeProviderRequestTimeout,
} from "../provider-http";

const DEFAULT_SENTRY_API_BASE_URL = "https://sentry.io/api/0";
const BLOCKED_SENTRY_QUERY_PARAM_NAMES = new Set([
  "access_token",
  "auth_token",
  "authorization",
]);
const ALLOWED_SENTRY_METHODS = new Set(["DELETE", "GET", "POST", "PUT"]);

interface SentryFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

type SentryRelayResponse =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

function normalizeOptionalString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function normalizeSentryMethod(method: string | undefined): string {
  const normalized = (method ?? "GET").toUpperCase();
  if (!ALLOWED_SENTRY_METHODS.has(normalized)) {
    throw new Error(`Unsupported Sentry method: ${normalized}`);
  }
  return normalized;
}

function normalizeSentrySlug(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    hasControlCharacters(normalized) ||
    /[/?#{}]/u.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function normalizeSentryAuthToken(credentials: SentryCredentials): string {
  const normalized = normalizeOptionalString(credentials.authToken);
  if (!normalized || hasControlCharacters(normalized)) {
    throw new Error("Sentry auth token is required");
  }
  return normalized;
}

function normalizeApiBaseUrl(credentials: SentryCredentials): string {
  const configuredBaseUrl =
    normalizeOptionalString(credentials.apiBaseUrl) ??
    DEFAULT_SENTRY_API_BASE_URL;
  const url = new URL(configuredBaseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Sentry API base URL must use http or https");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("Sentry API base URL must not include URL credentials");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(
      "Sentry API base URL must not include query params or fragments"
    );
  }
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  const pathSegments = trimmedPath
    .split("/")
    .filter((segment) => segment.length > 0);
  if (pathSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Sentry API base URL must not contain dot segments");
  }
  if (trimmedPath === "" || trimmedPath === "/") {
    url.pathname = "/api/0";
    return url.toString().replace(/\/$/, "");
  }
  url.pathname = trimmedPath;
  return url.toString().replace(/\/$/, "");
}

function resolveSentryEndpoint(
  endpoint: string,
  credentials: SentryCredentials
): string {
  const normalizedEndpoint = endpoint.trim();
  if (normalizedEndpoint.length === 0) {
    throw new Error("endpoint is required");
  }
  if (
    hasControlCharacters(normalizedEndpoint) ||
    normalizedEndpoint.startsWith("http://") ||
    normalizedEndpoint.startsWith("https://") ||
    normalizedEndpoint.includes("?") ||
    normalizedEndpoint.includes("#")
  ) {
    throw new Error(
      "Sentry endpoint must be a relative path without control characters, query params, or fragments"
    );
  }

  let resolved = normalizedEndpoint;
  resolved = resolved.replaceAll(
    "{organizationSlug}",
    encodeURIComponent(
      normalizeSentrySlug(credentials.organizationSlug, "organizationSlug")
    )
  );

  if (resolved.includes("{projectSlug}")) {
    const projectSlug = normalizeOptionalString(credentials.projectSlug);
    if (!projectSlug) {
      throw new Error(
        "projectSlug is required to use {projectSlug} in a Sentry endpoint"
      );
    }
    resolved = resolved.replaceAll(
      "{projectSlug}",
      encodeURIComponent(normalizeSentrySlug(projectSlug, "projectSlug"))
    );
  }

  const normalizedPath = resolved.startsWith("/") ? resolved : `/${resolved}`;
  const pathSegments = normalizedPath
    .split("/")
    .filter((segment) => segment.length > 0);
  if (pathSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Sentry endpoint must not contain dot segments");
  }

  return normalizedPath;
}

function sanitizeSentryText(
  text: string,
  credentials: SentryCredentials
): string {
  const authToken = normalizeOptionalString(credentials.authToken);
  if (!authToken) {
    return text.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
  }
  return text
    .split(authToken)
    .join("***")
    .slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function serializeSentryValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildSentryUrl(input: {
  credentials: SentryCredentials;
  endpoint: string;
  params?: Record<string, unknown>;
}): string {
  const baseUrl = normalizeApiBaseUrl(input.credentials);
  const resolvedEndpoint = resolveSentryEndpoint(
    input.endpoint,
    input.credentials
  );
  const url = new URL(`${baseUrl}${resolvedEndpoint}`);

  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (BLOCKED_SENTRY_QUERY_PARAM_NAMES.has(key.toLowerCase())) {
      throw new Error(`Sentry query param "${key}" is not allowed`);
    }
    const serialized = serializeSentryValue(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }

  return url.toString();
}

async function executeSentryRequest(input: {
  url: string;
  method: string;
  timeoutMs: number;
  body?: string;
  credentials: SentryCredentials;
}): Promise<SentryRelayResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs);
  const authToken = normalizeSentryAuthToken(input.credentials);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${authToken}`,
    };
    if (input.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(input.url, {
      body: input.body,
      headers,
      method: input.method,
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawError = await response.text().catch(() => "Unknown error");
      const detail = sanitizeSentryText(rawError, input.credentials);
      throw new Error(`Sentry API error (${response.status}): ${detail}`);
    }

    const raw = await response.text().catch(() => "");
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return {};
    }

    try {
      return JSON.parse(raw);
    } catch {
      return sanitizeSentryText(raw, input.credentials);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Sentry request timeout after ${input.timeoutMs}ms`, {
        cause: error,
      });
    }
    if (error instanceof Error) {
      throw new TypeError(
        sanitizeSentryText(error.message, input.credentials),
        { cause: error }
      );
    }
    throw new Error(sanitizeSentryText(String(error), input.credentials), {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchSentryApi(input: {
  credentials: SentryCredentials;
  endpoint: string;
  options?: SentryFetchOptions;
}): Promise<SentryRelayResponse> {
  const method = normalizeSentryMethod(input.options?.method);
  const timeoutMs = normalizeProviderRequestTimeout(input.options?.timeoutMs);
  const url = buildSentryUrl({
    credentials: input.credentials,
    endpoint: input.endpoint,
    params: input.options?.params,
  });
  const body =
    input.options?.body &&
    method !== "GET" &&
    method !== "HEAD" &&
    Object.keys(input.options.body).length > 0
      ? JSON.stringify(input.options.body)
      : undefined;

  return executeSentryRequest({
    body,
    credentials: input.credentials,
    method,
    timeoutMs,
    url,
  });
}

export async function listSentryProjects(input: {
  credentials: SentryCredentials;
  options?: SentryFetchOptions;
}): Promise<SentryRelayResponse> {
  return fetchSentryApi({
    credentials: input.credentials,
    endpoint: "/organizations/{organizationSlug}/projects/",
    options: {
      ...input.options,
      method: input.options?.method ?? "GET",
    },
  });
}
