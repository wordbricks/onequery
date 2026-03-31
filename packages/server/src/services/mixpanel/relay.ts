import type { MixpanelCredentials } from "@onequery/db/server";

import {
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
  normalizeProviderRequestTimeout,
} from "../provider-http";
import { ProviderHttpClient } from "../provider-http-client";
import { hasControlCharacters, serializeQueryParam } from "../provider-utils";

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

function buildMixpanelRequestBody(input: {
  method: string;
  body?: Record<string, MixpanelParamValue>;
  bodyFormat: "form" | "json";
}): {
  body?: Record<string, MixpanelParamValue> | string;
  contentType?: string;
} {
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
      body: input.body,
      contentType: "application/json",
    };
  }
  const formBody = new URLSearchParams();
  for (const [key, value] of Object.entries(input.body)) {
    const serialized = serializeQueryParam(value);
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

function createMixpanelHttpClient(
  credentials: MixpanelCredentials,
  baseUrl: string
) {
  return new ProviderHttpClient({
    auth: {
      password: credentials.secret,
      type: "basic",
      username: credentials.username,
    },
    baseUrl,
    defaultHeaders: {
      Accept: "application/json",
    },
    providerName: "Mixpanel",
    sanitize: (text) => sanitizeMixpanelText(text, credentials),
  });
}

function buildMixpanelParams(input: {
  params?: Record<string, MixpanelParamValue>;
  defaults?: Record<string, MixpanelParamValue>;
}): Record<string, unknown> | undefined {
  assertNoReservedKeys(input.params, "params");
  const params = new Map<string, MixpanelParamValue>();

  for (const [key, value] of Object.entries(input.params ?? {})) {
    params.set(key, value);
  }
  for (const [key, value] of Object.entries(input.defaults ?? {})) {
    if (!params.has(key)) {
      params.set(key, value);
    }
  }

  return Object.fromEntries(params.entries());
}

async function readMixpanelResponse(
  response: Response,
  credentials: MixpanelCredentials
): Promise<MixpanelRelayResponse> {
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
    return sanitizeMixpanelText(raw, credentials);
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
  const client = createMixpanelHttpClient(
    input.credentials,
    MIXPANEL_QUERY_API_URLS[input.credentials.region]
  );
  const requestBody = buildMixpanelRequestBody({
    body: input.options?.body,
    bodyFormat,
    method,
  });
  const response = await client.send({
    body: requestBody.body,
    endpoint: normalizeEndpoint(input.endpoint),
    headers: requestBody.contentType
      ? { "Content-Type": requestBody.contentType }
      : undefined,
    method,
    params: buildMixpanelParams({
      defaults,
      params: input.options?.params,
    }),
    timeoutMs,
  });

  return readMixpanelResponse(response, input.credentials);
}

export async function exportMixpanelEvents(input: {
  credentials: MixpanelCredentials;
  options?: MixpanelFetchOptions;
}): Promise<MixpanelRelayResponse> {
  const method = normalizeMethod(input.options?.method);
  const bodyFormat = input.options?.bodyFormat ?? "form";
  const timeoutMs = normalizeProviderRequestTimeout(input.options?.timeoutMs);
  const client = createMixpanelHttpClient(
    input.credentials,
    MIXPANEL_EXPORT_API_URLS[input.credentials.region]
  );
  const requestBody = buildMixpanelRequestBody({
    body: input.options?.body,
    bodyFormat,
    method,
  });
  const response = await client.send({
    body: requestBody.body,
    endpoint: "/",
    headers: requestBody.contentType
      ? { "Content-Type": requestBody.contentType }
      : undefined,
    method,
    params: buildMixpanelParams({
      defaults: { project_id: input.credentials.projectId },
      params: input.options?.params,
    }),
    timeoutMs,
  });

  return readMixpanelResponse(response, input.credentials);
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
