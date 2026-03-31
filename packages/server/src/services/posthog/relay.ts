import type { PostHogCredentials } from "@onequery/db/server";

import {
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
  normalizeProviderRequestTimeout,
} from "../provider-http";
import { ProviderHttpClient } from "../provider-http-client";
import { hasControlCharacters } from "../provider-utils";

type PostHogRelayResponse =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

function sanitizePostHogText(
  text: string,
  credentials: PostHogCredentials
): string {
  if (credentials.personalApiKey.length === 0) {
    return text.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
  }
  return text
    .split(credentials.personalApiKey)
    .join("***")
    .slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function normalizePostHogBaseUrl(hostUrl: string): string {
  const url = new URL(hostUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("PostHog host URL must use http or https");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("PostHog host URL must not include URL credentials");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(
      "PostHog host URL must not include query params or fragments"
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    // Comment: This relay always builds root-relative API paths, so subpath
    // deployments stay unsupported until the route contract is expanded.
    throw new Error("PostHog host URL must not include a path");
  }
  return url.origin;
}

function normalizeProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new Error("PostHog project ID is required");
  }
  return normalized;
}

function normalizePersonalApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new Error("PostHog personal API key is required");
  }
  return normalized;
}

function normalizeRefresh(refresh: string | undefined): string | undefined {
  if (refresh === undefined) {
    return undefined;
  }
  const normalized = refresh.trim();
  if (normalized.length === 0) {
    throw new Error("PostHog refresh must not be empty");
  }
  if (hasControlCharacters(normalized)) {
    throw new Error("PostHog refresh must not contain control characters");
  }
  return normalized;
}

function buildPostHogProjectUrl(input: {
  credentials: PostHogCredentials;
  endpoint: string;
}): string {
  const baseUrl = normalizePostHogBaseUrl(input.credentials.hostUrl);
  const projectId = normalizeProjectId(input.credentials.projectId);
  const normalizedEndpoint = input.endpoint.startsWith("/")
    ? input.endpoint
    : `/${input.endpoint}`;
  const url = new URL(
    `/api/projects/${encodeURIComponent(projectId)}${normalizedEndpoint}`,
    `${baseUrl}/`
  );
  return url.toString();
}

export async function runPostHogQuery(input: {
  credentials: PostHogCredentials;
  query: Record<string, unknown>;
  refresh?: string;
  timeoutMs?: number;
}): Promise<PostHogRelayResponse> {
  const timeoutMs = normalizeProviderRequestTimeout(input.timeoutMs);
  const personalApiKey = normalizePersonalApiKey(
    input.credentials.personalApiKey
  );
  const refresh = normalizeRefresh(input.refresh);
  const endpoint = buildPostHogProjectUrl({
    credentials: input.credentials,
    endpoint: "/query/",
  });
  const client = new ProviderHttpClient({
    auth: {
      token: personalApiKey,
      type: "bearer",
    },
    baseUrl: normalizePostHogBaseUrl(input.credentials.hostUrl),
    defaultHeaders: {
      Accept: "application/json",
    },
    providerName: "PostHog",
    sanitize: (text) => sanitizePostHogText(text, input.credentials),
  });

  return (await client.post(
    endpoint,
    {
      query: input.query,
      ...(refresh ? { refresh } : {}),
    },
    timeoutMs
  )) as PostHogRelayResponse;
}
