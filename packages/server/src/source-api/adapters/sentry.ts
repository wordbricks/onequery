import type { JsonObject } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { SentryCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
  MAX_PROVIDER_REQUEST_TIMEOUT_MS,
} from "../../services/provider-http";
import { ProviderHttpClient } from "../../services/provider-http-client";
import {
  hasControlCharacters,
  serializeQueryParam,
} from "../../services/provider-utils";
import {
  SourceApiInvalidRequestError,
  SourceApiUnsupportedOperationError,
} from "../errors";
import {
  createHttpRequestOperation,
  filterAllowedResponseHeaders,
  normalizeAllowedHeaders,
  readSourceApiHttpTransportResponse,
  resolveHttpMethodOverride,
} from "../helpers/http-rest";
import type {
  NormalizedHttpRequestPlan,
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResponse,
  SourceApiOperation,
  SourceApiRequestBody,
} from "../types";

const DEFAULT_SENTRY_API_BASE_URL = "https://sentry.io/api/0";
const SENTRY_DESCRIPTOR_VERSION = "sentry.v1";
const SENTRY_ALLOWED_METHODS = ["DELETE", "GET", "POST", "PUT"] as const;
const SENTRY_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;
const BLOCKED_SENTRY_QUERY_PARAM_NAMES = new Set([
  "access_token",
  "auth_token",
  "authorization",
]);

export const sentrySourceApiOperationSchema = z.enum(["fetch_api"]);

export type SentrySourceApiOperation = z.infer<
  typeof sentrySourceApiOperationSchema
>;

const sentryFieldPatchSchema = z
  .object({
    params: z.record(z.string(), z.unknown()).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
      .optional(),
  })
  .strict();

type SentryFieldPatch = z.infer<typeof sentryFieldPatchSchema>;

export type SentryTransportResponse = Awaited<
  ReturnType<typeof readSourceApiHttpTransportResponse>
>;

export class SentryInvalidRequestError extends SourceApiInvalidRequestError {}

export const sentrySourceApiAdapter: SourceApiAdapter = {
  provider: "sentry",
  async describe({ source }) {
    const examples = buildSentryExamples(source.sourceKey);

    return {
      defaultPathOperation: "fetch_api",
      descriptorVersion: SENTRY_DESCRIPTOR_VERSION,
      examples,
      notes: [
        "Use `{organizationSlug}` or `{projectSlug}` placeholders in the selector to target the connected Sentry source.",
      ],
      operations: [
        createHttpRequestOperation({
          allowedMethods: SENTRY_ALLOWED_METHODS,
          allowedResponseHeaders: SENTRY_ALLOWED_RESPONSE_HEADERS,
          defaultMethod: "GET",
          description:
            "Call a Sentry REST API endpoint for the connected source.",
          examples,
          name: "fetch_api",
          notes: [
            "Selectors must stay relative to the configured Sentry API base URL.",
            "Sentry request bodies must be JSON objects.",
          ],
          selectorKind: "path",
          selectorLabel: "PATH",
          summary: "Execute one Sentry API request.",
        }),
      ],
      source: {
        displayName: source.displayName,
        key: source.sourceKey,
        provider: source.provider,
      },
    };
  },
  async normalize({ descriptor, request, source }) {
    const operation = requireSentrySourceApiOperation({
      descriptor,
      operationName: request.operation,
    });

    const selector = normalizeSentrySelector(request.selector);
    const fieldPatch = parseSentryFieldPatch(request.fieldPatch);
    const method = resolveHttpMethodOverride({
      methodOverride: request.methodOverride,
      policy: operation.methodPolicy,
    });
    if (request.body.kind !== "none" && method === "GET") {
      throw new SentryInvalidRequestError(
        "GET requests cannot include a request body"
      );
    }

    validateSentryRequestBody(request.body);

    const headers = normalizeAllowedHeaders({
      allowedNames: operation.headerPolicy.allowedRequestHeaders,
      headers: request.headers,
    });

    return {
      body: request.body,
      descriptorVersion: descriptor.descriptorVersion,
      headers,
      kind: "http_request",
      method,
      operation: operation.name,
      paginationPolicy: operation.paginationPolicy,
      provider: source.provider,
      query: fieldPatch.params as JsonObject | undefined,
      selector,
      selectorTemplate: "/{path}",
      sourceId: source.id,
      sourceKey: source.sourceKey,
      timeoutMs: fieldPatch.timeoutMs,
      url: buildSentryUrl({
        credentials: requireSentryCredentials(source),
        endpoint: selector,
        params: fieldPatch.params,
      }),
    };
  },
  async execute({ prepared, source }) {
    if (prepared.kind !== "http_request") {
      throw new Error(
        `Sentry source API operation "${prepared.operation}" requires an HTTP plan`
      );
    }

    const selector = normalizeSentryPlanSelector(prepared);
    const response = await requestSentrySourceApi({
      body: prepared.body,
      credentials: requireSentryCredentials(source),
      method: prepared.method,
      params: prepared.query,
      selector,
      timeoutMs: prepared.timeoutMs,
    });

    return buildSentryExecutionResponse({
      operation: prepared.operation,
      response,
      selector,
      source,
    });
  },
};

export function isSentrySourceCredentials(
  value: unknown
): value is SentryCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "sentry"
  );
}

export async function requestSentrySourceApi(input: {
  body: SourceApiRequestBody;
  credentials: SentryCredentials;
  method: string;
  params?: Record<string, unknown>;
  selector: string;
  timeoutMs?: number;
}): Promise<SentryTransportResponse> {
  const response = await createSentryHttpClient(input.credentials).send({
    body: buildSentryRequestBody({
      body: input.body,
      method: input.method,
    }),
    endpoint: buildSentryUrl({
      credentials: input.credentials,
      endpoint: input.selector,
      params: input.params,
    }),
    method: input.method,
    timeoutMs: input.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

export function buildSentryUrl(input: {
  credentials: SentryCredentials;
  endpoint: string;
  params?: Record<string, unknown>;
}): string {
  const url = new URL(
    `${normalizeApiBaseUrl(input.credentials).replace(/\/+$/, "")}/${resolveSentryEndpoint(
      input.endpoint,
      input.credentials
    ).replace(/^\/+/, "")}`
  );

  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (BLOCKED_SENTRY_QUERY_PARAM_NAMES.has(key.toLowerCase())) {
      throw new SentryInvalidRequestError(
        `Sentry query param "${key}" is not allowed`
      );
    }

    const serialized = serializeQueryParam(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }

  return url.toString();
}

function buildSentryExamples(sourceKey: string): SourceApiExample[] {
  return [
    {
      command: `onequery api --source ${sourceKey} /organizations/{organizationSlug}/issues/ -f 'params[query]=is:unresolved'`,
      description:
        "List unresolved Sentry issues for the connected organization.",
      label: "List issues",
    },
  ];
}

function requireSentrySourceApiOperation(input: {
  descriptor: SourceApiDescriptor;
  operationName: string;
}): SourceApiOperation {
  const operation = input.descriptor.operations.find(
    (candidate) => candidate.name === input.operationName.trim()
  );
  if (operation) {
    return operation;
  }

  throw new SourceApiUnsupportedOperationError(input.operationName);
}

function parseSentryFieldPatch(
  value: Record<string, unknown> | undefined
): SentryFieldPatch {
  if (!value) {
    return {};
  }

  const parsed = sentryFieldPatchSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new SentryInvalidRequestError("Invalid Sentry field patch");
}

function requireSentryCredentials(
  source: PreparedSourceConnection
): SentryCredentials {
  if (isSentrySourceCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("Sentry source credentials are invalid");
}

function normalizeSentryPlanSelector(plan: NormalizedHttpRequestPlan): string {
  const selector = plan.selector?.trim();
  if (selector) {
    return selector;
  }

  throw new Error(
    `Sentry source API operation "${plan.operation}" requires a selector`
  );
}

function normalizeSentrySelector(selector: string | undefined): string {
  const normalized = selector?.trim();
  if (!normalized) {
    throw new SentryInvalidRequestError(
      'Sentry operation "fetch_api" requires a selector'
    );
  }
  if (
    hasControlCharacters(normalized) ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.includes("?") ||
    normalized.includes("#")
  ) {
    throw new SentryInvalidRequestError(
      "Sentry selectors must be relative paths without query params or fragments"
    );
  }

  return normalized;
}

function validateSentryRequestBody(body: SourceApiRequestBody): void {
  switch (body.kind) {
    case "none":
      return;
    case "json":
      if (!isRecord(body.value)) {
        throw new SentryInvalidRequestError(
          "Sentry request bodies must be JSON objects"
        );
      }
      return;
    case "text":
    case "binary":
      throw new SentryInvalidRequestError(
        "Sentry request bodies must be JSON objects"
      );
  }
}

function buildSentryRequestBody(input: {
  body: SourceApiRequestBody;
  method: string;
}): Record<string, unknown> | undefined {
  const parsedBody = parseSentryJsonObjectBody(input.body);
  if (!parsedBody || input.method === "GET") {
    return undefined;
  }

  return parsedBody;
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSentrySlug(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    hasControlCharacters(normalized) ||
    /[/?#{}]/u.test(normalized)
  ) {
    throw new SentryInvalidRequestError(`${field} is invalid`);
  }
  return normalized;
}

function normalizeSentryAuthToken(credentials: SentryCredentials): string {
  const normalized = normalizeOptionalString(credentials.authToken);
  if (!normalized || hasControlCharacters(normalized)) {
    throw new SentryInvalidRequestError("Sentry auth token is required");
  }
  return normalized;
}

function normalizeApiBaseUrl(credentials: SentryCredentials): string {
  const configuredBaseUrl =
    normalizeOptionalString(credentials.apiBaseUrl) ??
    DEFAULT_SENTRY_API_BASE_URL;
  const url = new URL(configuredBaseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SentryInvalidRequestError(
      "Sentry API base URL must use http or https"
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new SentryInvalidRequestError(
      "Sentry API base URL must not include URL credentials"
    );
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new SentryInvalidRequestError(
      "Sentry API base URL must not include query params or fragments"
    );
  }
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  const pathSegments = trimmedPath
    .split("/")
    .filter((segment) => segment.length > 0);
  if (pathSegments.some((segment) => segment === "." || segment === "..")) {
    throw new SentryInvalidRequestError(
      "Sentry API base URL must not contain dot segments"
    );
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
    throw new SentryInvalidRequestError("endpoint is required");
  }
  if (
    hasControlCharacters(normalizedEndpoint) ||
    normalizedEndpoint.startsWith("http://") ||
    normalizedEndpoint.startsWith("https://") ||
    normalizedEndpoint.includes("?") ||
    normalizedEndpoint.includes("#")
  ) {
    throw new SentryInvalidRequestError(
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
      throw new SentryInvalidRequestError(
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
    throw new SentryInvalidRequestError(
      "Sentry endpoint must not contain dot segments"
    );
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

function createSentryHttpClient(credentials: SentryCredentials) {
  return new ProviderHttpClient({
    auth: {
      token: normalizeSentryAuthToken(credentials),
      type: "bearer",
    },
    baseUrl: normalizeApiBaseUrl(credentials),
    blockedParams: BLOCKED_SENTRY_QUERY_PARAM_NAMES,
    defaultHeaders: {
      Accept: "application/json",
    },
    providerName: "Sentry",
    sanitize: (text) => sanitizeSentryText(text, credentials),
  });
}

function parseSentryJsonObjectBody(
  body: SourceApiRequestBody
): Record<string, unknown> | undefined {
  validateSentryRequestBody(body);
  if (body.kind === "none") {
    return undefined;
  }

  return body.value as Record<string, unknown>;
}

function buildSentryExecutionResponse(input: {
  operation: string;
  response: SentryTransportResponse;
  selector: string;
  source: PreparedSourceConnection;
}): SourceApiExecutionResponse {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: SENTRY_ALLOWED_RESPONSE_HEADERS,
      contentType: input.response.contentType,
      headers: input.response.headers,
    }),
    operation: input.operation,
    selector: input.selector,
    source: {
      displayName: input.source.displayName,
      key: input.source.sourceKey,
      provider: input.source.provider,
    },
    status: input.response.status,
  };
}
