import type { AmplitudeCredentials } from "@onequery/db/server";

import { encodeBasicAuthHeader } from "../../lib/base64";
import { normalizeProviderRequestTimeout } from "../provider-http";

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

function buildAmplitudeAuthHeader(credentials: AmplitudeCredentials): string {
  return encodeBasicAuthHeader(credentials.apiKey, credentials.secretKey);
}

function serializeAmplitudeValue(value: AmplitudeParamValue): string | null {
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

function buildAmplitudeUrl(input: {
  baseUrl: string;
  endpoint: string;
  params?: Record<string, AmplitudeParamValue>;
}): string {
  const normalizedEndpoint = input.endpoint.startsWith("/")
    ? input.endpoint
    : `/${input.endpoint}`;
  const url = new URL(`${input.baseUrl}${normalizedEndpoint}`);
  for (const [key, value] of Object.entries(input.params ?? {})) {
    const serialized = serializeAmplitudeValue(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }
  return url.toString();
}

async function executeAmplitudeRequest(input: {
  url: string;
  method: string;
  authHeader: string;
  timeoutMs: number;
  body?: string;
  credentials: AmplitudeCredentials;
}): Promise<AmplitudeRelayResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: input.authHeader,
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
      const detail = sanitizeAmplitudeText(rawError, input.credentials);
      throw new Error(`Amplitude API error (${response.status}): ${detail}`);
    }

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
      return sanitizeAmplitudeText(raw, input.credentials);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Amplitude request timeout after ${input.timeoutMs}ms`, {
        cause: error,
      });
    }
    if (error instanceof Error) {
      throw new TypeError(
        sanitizeAmplitudeText(error.message, input.credentials),
        { cause: error }
      );
    }
    throw new Error(sanitizeAmplitudeText(String(error), input.credentials), {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
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
  const baseUrl = AMPLITUDE_API_URLS[input.credentials.region];
  const url = buildAmplitudeUrl({
    baseUrl,
    endpoint,
    params: input.options?.params,
  });
  const body =
    input.options?.body &&
    method !== "GET" &&
    method !== "HEAD" &&
    Object.keys(input.options.body).length > 0
      ? JSON.stringify(input.options.body)
      : undefined;

  return executeAmplitudeRequest({
    authHeader: buildAmplitudeAuthHeader(input.credentials),
    body,
    credentials: input.credentials,
    method,
    timeoutMs,
    url,
  });
}
