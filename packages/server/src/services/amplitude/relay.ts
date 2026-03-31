import type { AmplitudeCredentials } from "@onequery/db/server";

import { normalizeProviderRequestTimeout } from "../provider-http";
import { ProviderHttpClient } from "../provider-http-client";
import { serializeQueryParam } from "../provider-utils";

const AMPLITUDE_API_URLS = {
  eu: "https://analytics.eu.amplitude.com",
  us: "https://amplitude.com",
} as const;

type AmplitudeParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | unknown[];

export interface AmplitudeFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, AmplitudeParamValue>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

type AmplitudeRelayResponse =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

function sanitizeAmplitudeText(
  text: string,
  credentials: AmplitudeCredentials
): string {
  let sanitized = text;
  if (credentials.apiKey.length > 0) {
    sanitized = sanitized.split(credentials.apiKey).join("***");
  }
  if (credentials.secretKey.length > 0) {
    sanitized = sanitized.split(credentials.secretKey).join("***");
  }
  return sanitized;
}

function createAmplitudeHttpClient(credentials: AmplitudeCredentials) {
  return new ProviderHttpClient({
    auth: {
      password: credentials.secretKey,
      type: "basic",
      username: credentials.apiKey,
    },
    baseUrl: AMPLITUDE_API_URLS[credentials.region],
    defaultHeaders: {
      Accept: "application/json",
    },
    providerName: "Amplitude",
    sanitize: (text) => sanitizeAmplitudeText(text, credentials),
  });
}

function normalizeAmplitudeBody(
  body: Record<string, unknown> | undefined,
  method: string
): Record<string, unknown> | undefined {
  if (
    !body ||
    method === "GET" ||
    method === "HEAD" ||
    Object.keys(body).length === 0
  ) {
    return undefined;
  }

  return body;
}

function normalizeAmplitudeParams(
  params: Record<string, AmplitudeParamValue> | undefined
): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(params)
      .map(([key, value]) => [key, serializeQueryParam(value)])
      .filter((entry): entry is [string, string] => entry[1] !== null)
  );
}

async function readAmplitudeResponse(
  response: Response,
  credentials: AmplitudeCredentials
): Promise<AmplitudeRelayResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/gzip") ||
    contentType.includes("application/zip")
  ) {
    const buffer = await response.arrayBuffer();
    return {
      contentType,
      note: "Binary data received. Download and unpack this export outside the SDK.",
      size: buffer.byteLength,
      type: "binary",
    };
  }

  const raw = await response.text().catch(() => "");
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {};
  }

  try {
    return JSON.parse(raw) as AmplitudeRelayResponse;
  } catch {
    return sanitizeAmplitudeText(raw, credentials);
  }
}

export async function fetchAmplitudeApi(input: {
  credentials: AmplitudeCredentials;
  endpoint: string;
  options?: AmplitudeFetchOptions;
}): Promise<AmplitudeRelayResponse> {
  const endpoint = input.endpoint.trim();
  if (endpoint.length === 0) {
    throw new Error("endpoint is required");
  }

  const method = (input.options?.method ?? "GET").toUpperCase();
  const timeoutMs = normalizeProviderRequestTimeout(input.options?.timeoutMs);
  const client = createAmplitudeHttpClient(input.credentials);
  const response = await client.send({
    body: normalizeAmplitudeBody(input.options?.body, method),
    endpoint,
    method,
    params: normalizeAmplitudeParams(input.options?.params),
    timeoutMs,
  });

  return readAmplitudeResponse(response, input.credentials);
}
