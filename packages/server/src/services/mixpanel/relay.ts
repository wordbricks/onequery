import type { MixpanelCredentials } from "@onequery/db/server";

import { encodeBasicAuthHeader } from "../../lib/base64";
import {
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
  normalizeProviderRequestTimeout,
} from "../provider-http";

const MIXPANEL_QUERY_API_URLS = {
  eu: "https://eu.mixpanel.com/api",
  in: "https://in.mixpanel.com/api",
  us: "https://mixpanel.com/api",
} as const;

const MIXPANEL_EXPORT_API_URLS = {
  eu: "https://data-eu.mixpanel.com/api/2.0/export",
  in: "https://data-in.mixpanel.com/api/2.0/export",
  us: "https://data.mixpanel.com/api/2.0/export",
} as const;

export const DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE = 100;
export const MAX_MIXPANEL_ENGAGE_PAGE_SIZE = 1000;
const RESERVED_MIXPANEL_KEYS = new Set(["project_id", "workspace_id"]);
const ALLOWED_MIXPANEL_METHODS = new Set(["DELETE", "GET", "POST", "PUT"]);

type MixpanelRelayResponse =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

type MixpanelParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | unknown[];

export interface MixpanelFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, MixpanelParamValue>;
  body?: Record<string, MixpanelParamValue>;
  bodyFormat?: "form" | "json";
  timeoutMs?: number;
}

interface MixpanelEngageRequest {
  where?: string;
  page?: number;
  pageSize?: number;
  outputProperties?: string[];
}

interface MixpanelSegmentationRequest {
  event: string;
  fromDate: string;
  toDate: string;
  unit?: "hour" | "day" | "week" | "month";
  type?: "general" | "unique" | "average";
  where?: string;
}

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

function normalizeMethod(method: string | undefined): string {
  const normalized = (method ?? "GET").toUpperCase();
  if (!ALLOWED_MIXPANEL_METHODS.has(normalized)) {
    throw new Error(`Unsupported Mixpanel method: ${normalized}`);
  }
  return normalized;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (
    hasControlCharacters(trimmed) ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    throw new Error(
      "Mixpanel endpoint must not include control characters, query params, or fragments"
    );
  }

  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const pathSegments = normalized
    .split("/")
    .filter((segment) => segment.length > 0);
  if (pathSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Mixpanel endpoint must not contain dot segments");
  }

  return normalized;
}

function assertNoReservedKeys(
  values: Record<string, MixpanelParamValue> | undefined,
  location: "body" | "params"
): void {
  for (const key of Object.keys(values ?? {})) {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey.length === 0) {
      continue;
    }
    if (hasControlCharacters(key)) {
      throw new Error(`Mixpanel ${location} key "${key}" is invalid`);
    }
    if (RESERVED_MIXPANEL_KEYS.has(normalizedKey)) {
      throw new Error(`Mixpanel ${location} key "${key}" is reserved`);
    }
  }
}

function normalizeEngagePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) {
    return DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE;
  }
  if (!Number.isInteger(pageSize)) {
    throw new TypeError("pageSize must be an integer");
  }
  if (pageSize < 1 || pageSize > MAX_MIXPANEL_ENGAGE_PAGE_SIZE) {
    throw new Error(
      `pageSize must be between 1 and ${MAX_MIXPANEL_ENGAGE_PAGE_SIZE}`
    );
  }
  return pageSize;
}

function normalizeEngagePage(page: number | undefined): number {
  if (page === undefined) {
    return 0;
  }
  if (!Number.isInteger(page) || page < 0) {
    throw new Error("page must be an integer >= 0");
  }
  return page;
}

function serializeMixpanelValue(value: MixpanelParamValue): string | null {
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

function sanitizeMixpanelText(
  text: string,
  credentials: MixpanelCredentials
): string {
  let sanitized = text;
  if (credentials.username.length > 0) {
    sanitized = sanitized.split(credentials.username).join("***");
  }
  if (credentials.secret.length > 0) {
    sanitized = sanitized.split(credentials.secret).join("***");
  }
  return sanitized.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function buildMixpanelAuthHeader(credentials: MixpanelCredentials): string {
  return encodeBasicAuthHeader(credentials.username, credentials.secret);
}

function buildMixpanelUrl(input: {
  baseUrl: string;
  endpoint: string;
  params?: Record<string, MixpanelParamValue>;
  defaults?: Record<string, MixpanelParamValue>;
}): string {
  const normalizedEndpoint = normalizeEndpoint(input.endpoint);
  assertNoReservedKeys(input.params, "params");
  const url = new URL(`${input.baseUrl}${normalizedEndpoint}`);
  for (const [key, value] of Object.entries(input.params ?? {})) {
    const serialized = serializeMixpanelValue(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }
  for (const [key, value] of Object.entries(input.defaults ?? {})) {
    if (url.searchParams.has(key)) {
      continue;
    }
    const serialized = serializeMixpanelValue(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }
  return url.toString();
}

function buildMixpanelRequestBody(input: {
  method: string;
  body?: Record<string, MixpanelParamValue>;
  bodyFormat: "form" | "json";
}): { body?: string; contentType?: string } {
  const normalizedMethod = normalizeMethod(input.method);
  if (
    !input.body ||
    normalizedMethod === "GET" ||
    normalizedMethod === "HEAD"
  ) {
    return {};
  }
  assertNoReservedKeys(input.body, "body");
  if (input.bodyFormat === "json") {
    return {
      body: JSON.stringify(input.body),
      contentType: "application/json",
    };
  }
  const formBody = new URLSearchParams();
  for (const [key, value] of Object.entries(input.body)) {
    const serialized = serializeMixpanelValue(value);
    if (serialized === null) {
      continue;
    }
    formBody.set(key, serialized);
  }
  return {
    body: formBody.toString(),
    contentType: "application/x-www-form-urlencoded",
  };
}

async function executeMixpanelRequest(input: {
  url: string;
  method: string;
  authHeader: string;
  timeoutMs: number;
  body?: string;
  contentType?: string;
  credentials: MixpanelCredentials;
}): Promise<MixpanelRelayResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: input.authHeader,
    };
    if (input.body !== undefined) {
      headers["Content-Type"] = input.contentType ?? "application/json";
    }

    const response = await fetch(input.url, {
      body: input.body,
      headers,
      method: input.method,
      signal: controller.signal,
    });
    if (!response.ok) {
      const rawError = await response.text().catch(() => "Unknown error");
      const detail = sanitizeMixpanelText(rawError, input.credentials);
      throw new Error(`Mixpanel API error (${response.status}): ${detail}`);
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
      return JSON.parse(raw) as MixpanelRelayResponse;
    } catch {
      return sanitizeMixpanelText(raw, input.credentials);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Mixpanel request timeout after ${input.timeoutMs}ms`, {
        cause: error,
      });
    }
    if (error instanceof Error) {
      throw new TypeError(
        sanitizeMixpanelText(error.message, input.credentials),
        { cause: error }
      );
    }
    throw new Error(sanitizeMixpanelText(String(error), input.credentials), {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchMixpanelQueryApi(input: {
  credentials: MixpanelCredentials;
  endpoint: string;
  options?: MixpanelFetchOptions;
}): Promise<MixpanelRelayResponse> {
  const method = normalizeMethod(input.options?.method);
  const bodyFormat = input.options?.bodyFormat ?? "form";
  const timeoutMs = normalizeProviderRequestTimeout(input.options?.timeoutMs);
  const defaults: Record<string, MixpanelParamValue> = {
    project_id: input.credentials.projectId,
    workspace_id: input.credentials.workspaceId,
  };
  const baseUrl = MIXPANEL_QUERY_API_URLS[input.credentials.region];
  const url = buildMixpanelUrl({
    baseUrl,
    defaults,
    endpoint: input.endpoint,
    params: input.options?.params,
  });
  const requestBody = buildMixpanelRequestBody({
    body: input.options?.body,
    bodyFormat,
    method,
  });

  return executeMixpanelRequest({
    authHeader: buildMixpanelAuthHeader(input.credentials),
    body: requestBody.body,
    contentType: requestBody.contentType,
    credentials: input.credentials,
    method,
    timeoutMs,
    url,
  });
}

export async function exportMixpanelEvents(input: {
  credentials: MixpanelCredentials;
  options?: MixpanelFetchOptions;
}): Promise<MixpanelRelayResponse> {
  const method = normalizeMethod(input.options?.method);
  const bodyFormat = input.options?.bodyFormat ?? "form";
  const timeoutMs = normalizeProviderRequestTimeout(input.options?.timeoutMs);
  const baseUrl = MIXPANEL_EXPORT_API_URLS[input.credentials.region];
  const url = buildMixpanelUrl({
    baseUrl,
    defaults: { project_id: input.credentials.projectId },
    endpoint: "",
    params: input.options?.params,
  });
  const requestBody = buildMixpanelRequestBody({
    body: input.options?.body,
    bodyFormat,
    method,
  });

  return executeMixpanelRequest({
    authHeader: buildMixpanelAuthHeader(input.credentials),
    body: requestBody.body,
    contentType: requestBody.contentType,
    credentials: input.credentials,
    method,
    timeoutMs,
    url,
  });
}

export async function queryMixpanelEngage(input: {
  credentials: MixpanelCredentials;
  request: MixpanelEngageRequest;
}): Promise<MixpanelRelayResponse> {
  const page = normalizeEngagePage(input.request.page);
  const pageSize = normalizeEngagePageSize(input.request.pageSize);

  return fetchMixpanelQueryApi({
    credentials: input.credentials,
    endpoint: "/query/engage",
    options: {
      body: {
        filter_by_cohort: {},
        page,
        page_size: pageSize,
        where: normalizeOptionalString(input.request.where) ?? undefined,
        output_properties:
          input.request.outputProperties &&
          input.request.outputProperties.length > 0
            ? input.request.outputProperties
            : undefined,
      },
      bodyFormat: "form",
      method: "POST",
    },
  });
}

export async function queryMixpanelSegmentation(input: {
  credentials: MixpanelCredentials;
  request: MixpanelSegmentationRequest;
}): Promise<MixpanelRelayResponse> {
  const event = normalizeOptionalString(input.request.event);
  const fromDate = normalizeOptionalString(input.request.fromDate);
  const toDate = normalizeOptionalString(input.request.toDate);
  if (!event) {
    throw new Error("event is required");
  }
  if (!fromDate) {
    throw new Error("fromDate is required");
  }
  if (!toDate) {
    throw new Error("toDate is required");
  }

  return fetchMixpanelQueryApi({
    credentials: input.credentials,
    endpoint: "/query/segmentation",
    options: {
      method: "GET",
      params: {
        event: [event],
        from_date: fromDate,
        to_date: toDate,
        type: input.request.type,
        unit: input.request.unit,
        where: normalizeOptionalString(input.request.where) ?? undefined,
      },
    },
  });
}
