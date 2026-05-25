import type { JsonObject } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { Credentials, ProviderType } from "@onequery/db/server";
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
  toHeaderRecord,
} from "../helpers/http-rest";
import type {
  PreparedHttpSourceApi,
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResult,
  SourceApiOperation,
  SourceApiRequestBody,
  SourceApiResponseBody,
  SourceApiContinuationState,
  SourceApiPaginationPolicy,
} from "../types";

type SimpleRestCredentials = Extract<Credentials, { type: ProviderType }>;

type SimpleRestAuth =
  | { type: "bearer"; token: string }
  | { type: "raw"; value: string };

type SimpleRestContinuationState = {
  params: JsonObject;
};

type SimpleRestAdapterConfig<TCredentials extends SimpleRestCredentials> = {
  provider: TCredentials["type"];
  providerLabel: string;
  descriptorVersion: string;
  apiBaseUrl: (credentials: TCredentials) => string;
  auth: (credentials: TCredentials) => SimpleRestAuth;
  defaultHeaders?: (credentials: TCredentials) => Record<string, string>;
  allowedMethods?: readonly string[];
  allowedRequestHeaders?: readonly string[];
  allowedResponseHeaders?: readonly string[];
  blockedQueryParamNames?: ReadonlySet<string>;
  buildEndpoint?: (input: {
    credentials: TCredentials;
    selector: string;
  }) => string;
  buildExamples: (sourceKey: string) => SourceApiExample[];
  notes?: readonly string[];
  operationNotes?: readonly string[];
  paginationPolicy?: SourceApiPaginationPolicy;
  readNextContinuationState?: (
    body: SourceApiResponseBody
  ) => SimpleRestContinuationState | undefined;
};

const SIMPLE_REST_ALLOWED_METHODS = ["DELETE", "GET", "PATCH", "POST", "PUT"];
const SIMPLE_REST_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
] as const;
const SIMPLE_REST_BLOCKED_QUERY_PARAM_NAMES = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth_token",
  "authorization",
  "client_secret",
  "key",
  "token",
]);

const simpleRestFieldPatchSchema = z
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

type SimpleRestFieldPatch = z.infer<typeof simpleRestFieldPatchSchema>;

type SimpleRestTransportResponse = Awaited<
  ReturnType<typeof readSourceApiHttpTransportResponse>
>;

class SimpleRestInvalidRequestError extends SourceApiInvalidRequestError {}

export function createSimpleRestSourceApiAdapter<
  TCredentials extends SimpleRestCredentials,
>(config: SimpleRestAdapterConfig<TCredentials>): SourceApiAdapter {
  return {
    provider: config.provider,
    async describe({ source }) {
      const examples = config.buildExamples(source.sourceKey);

      return {
        defaultPathOperation: "fetch_api",
        descriptorVersion: config.descriptorVersion,
        examples,
        notes: config.notes ?? [],
        operations: [
          createHttpRequestOperation({
            allowedMethods:
              config.allowedMethods ?? SIMPLE_REST_ALLOWED_METHODS,
            allowedRequestHeaders: config.allowedRequestHeaders ?? [
              "Accept",
              "Content-Type",
            ],
            allowedResponseHeaders:
              config.allowedResponseHeaders ??
              SIMPLE_REST_ALLOWED_RESPONSE_HEADERS,
            defaultMethod: "GET",
            description: `Call a ${config.providerLabel} REST API endpoint for the connected source.`,
            examples,
            name: "fetch_api",
            notes: [
              "Use `params` in the field patch for query string values.",
              `${config.providerLabel} request bodies must be JSON objects.`,
              ...(config.operationNotes ?? []),
            ],
            paginationPolicy: config.paginationPolicy ?? "none",
            selectorKind: "path",
            selectorLabel: "PATH",
            summary: `Execute one ${config.providerLabel} API request.`,
          }),
        ],
        source: {
          displayName: source.displayName,
          sourceKey: source.sourceKey,
          provider: source.provider,
        },
      };
    },
    async normalize({ descriptor, request, source }) {
      const operation = requireSimpleRestSourceApiOperation({
        descriptor,
        operationName: request.operation,
      });

      const credentials = requireSimpleRestCredentials(source, config);
      const selector = normalizeSimpleRestSelector({
        providerLabel: config.providerLabel,
        selector: request.selector,
      });
      const fieldPatch = parseSimpleRestFieldPatch({
        providerLabel: config.providerLabel,
        value: request.fieldPatch,
      });
      validateSimpleRestQueryParams({
        blockedNames:
          config.blockedQueryParamNames ??
          SIMPLE_REST_BLOCKED_QUERY_PARAM_NAMES,
        params: fieldPatch.params,
        providerLabel: config.providerLabel,
      });
      const method = resolveHttpMethodOverride({
        methodOverride: request.methodOverride,
        policy: operation.methodPolicy,
      });
      if (request.body.kind !== "none" && method === "GET") {
        throw new SimpleRestInvalidRequestError(
          "GET requests cannot include a request body"
        );
      }
      validateSimpleRestRequestBody({
        body: request.body,
        providerLabel: config.providerLabel,
      });

      const headers = normalizeAllowedHeaders({
        allowedNames: operation.headerPolicy.allowedRequestHeaders,
        headers: request.headers,
      });
      const url = buildSimpleRestUrl({
        config,
        credentials,
        params: fieldPatch.params,
        selector,
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
        url,
      };
    },
    async execute({ continuation, prepared, source }) {
      if (prepared.kind !== "http_request") {
        throw new Error(
          `${config.providerLabel} source API operation "${prepared.operation}" requires an HTTP plan`
        );
      }

      const credentials = requireSimpleRestCredentials(source, config);
      const selector = normalizeSimpleRestPlanSelector(prepared, config);
      const continuationParams =
        parseSimpleRestContinuationState(continuation)?.params;
      const params = {
        ...(prepared.query ?? {}),
        ...(continuationParams ?? {}),
      };
      const response = await requestSimpleRestSourceApi({
        body: prepared.body,
        config,
        credentials,
        headers: prepared.headers,
        method: prepared.method,
        params,
        selector,
        timeoutMs: prepared.timeoutMs,
      });

      return buildSimpleRestExecutionResponse({
        config,
        operation: prepared.operation,
        response,
        selector,
        source,
      });
    },
  };
}

function requireSimpleRestSourceApiOperation(input: {
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

function requireSimpleRestCredentials<
  TCredentials extends SimpleRestCredentials,
>(
  source: PreparedSourceConnection,
  config: SimpleRestAdapterConfig<TCredentials>
): TCredentials {
  if (source.credentials.type === config.provider) {
    return source.credentials as TCredentials;
  }

  throw new Error(`${config.providerLabel} source credentials are invalid`);
}

function parseSimpleRestFieldPatch(input: {
  providerLabel: string;
  value: Record<string, unknown> | undefined;
}): SimpleRestFieldPatch {
  if (!input.value) {
    return {};
  }

  const parsed = simpleRestFieldPatchSchema.safeParse(input.value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new SimpleRestInvalidRequestError(
    `Invalid ${input.providerLabel} field patch`
  );
}

function normalizeSimpleRestPlanSelector<
  TCredentials extends SimpleRestCredentials,
>(
  plan: PreparedHttpSourceApi,
  config: SimpleRestAdapterConfig<TCredentials>
): string {
  const selector = plan.selector?.trim();
  if (selector) {
    return selector;
  }

  throw new Error(
    `${config.providerLabel} source API operation "${plan.operation}" requires a selector`
  );
}

function normalizeSimpleRestSelector(input: {
  providerLabel: string;
  selector: string | undefined;
}): string {
  const normalized = input.selector?.trim();
  if (!normalized) {
    throw new SimpleRestInvalidRequestError(
      `${input.providerLabel} operation "fetch_api" requires a selector`
    );
  }
  if (
    hasControlCharacters(normalized) ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.includes("?") ||
    normalized.includes("#")
  ) {
    throw new SimpleRestInvalidRequestError(
      `${input.providerLabel} selectors must be relative paths without query params or fragments`
    );
  }

  const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new SimpleRestInvalidRequestError(
      `${input.providerLabel} selectors must not contain dot segments`
    );
  }

  return path;
}

function validateSimpleRestRequestBody(input: {
  body: SourceApiRequestBody;
  providerLabel: string;
}): void {
  switch (input.body.kind) {
    case "none":
      return;
    case "json":
      if (!isRecord(input.body.value)) {
        throw new SimpleRestInvalidRequestError(
          `${input.providerLabel} request bodies must be JSON objects`
        );
      }
      return;
    case "text":
    case "binary":
      throw new SimpleRestInvalidRequestError(
        `${input.providerLabel} request bodies must be JSON objects`
      );
  }
}

function buildSimpleRestRequestBody(input: {
  body: SourceApiRequestBody;
  method: string;
}): Record<string, unknown> | undefined {
  if (input.body.kind === "none" || input.method === "GET") {
    return undefined;
  }

  return input.body.value as Record<string, unknown>;
}

function validateSimpleRestQueryParams(input: {
  blockedNames: ReadonlySet<string>;
  params: Record<string, unknown> | undefined;
  providerLabel: string;
}): void {
  for (const key of Object.keys(input.params ?? {})) {
    if (input.blockedNames.has(key.toLowerCase())) {
      throw new SimpleRestInvalidRequestError(
        `${input.providerLabel} request param "${key}" is not allowed`
      );
    }
  }
}

function buildSimpleRestUrl<TCredentials extends SimpleRestCredentials>(input: {
  config: SimpleRestAdapterConfig<TCredentials>;
  credentials: TCredentials;
  params?: Record<string, unknown>;
  selector: string;
}): string {
  const endpoint =
    input.config.buildEndpoint?.({
      credentials: input.credentials,
      selector: input.selector,
    }) ?? input.selector;
  const url = new URL(input.config.apiBaseUrl(input.credentials));
  const basePath = url.pathname.replace(/\/+$/, "");
  const endpointPath = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  url.pathname = `${basePath}${endpointPath}`;
  url.search = "";
  url.hash = "";

  for (const [key, value] of Object.entries(input.params ?? {})) {
    const serialized = serializeQueryParam(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }

  return url.toString();
}

async function requestSimpleRestSourceApi<
  TCredentials extends SimpleRestCredentials,
>(input: {
  body: SourceApiRequestBody;
  config: SimpleRestAdapterConfig<TCredentials>;
  credentials: TCredentials;
  headers: readonly { name: string; value: string }[];
  method: string;
  params?: Record<string, unknown>;
  selector: string;
  timeoutMs?: number;
}): Promise<SimpleRestTransportResponse> {
  const response = await createSimpleRestHttpClient({
    config: input.config,
    credentials: input.credentials,
  }).send({
    body: buildSimpleRestRequestBody({
      body: input.body,
      method: input.method,
    }),
    endpoint: buildSimpleRestUrl({
      config: input.config,
      credentials: input.credentials,
      params: input.params,
      selector: input.selector,
    }),
    headers: toHeaderRecord(input.headers),
    method: input.method,
    timeoutMs: input.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

function createSimpleRestHttpClient<
  TCredentials extends SimpleRestCredentials,
>(input: {
  config: SimpleRestAdapterConfig<TCredentials>;
  credentials: TCredentials;
}) {
  return new ProviderHttpClient({
    auth: input.config.auth(input.credentials),
    baseUrl: input.config.apiBaseUrl(input.credentials),
    blockedParams:
      input.config.blockedQueryParamNames ??
      SIMPLE_REST_BLOCKED_QUERY_PARAM_NAMES,
    defaultHeaders: {
      Accept: "application/json",
      ...(input.config.defaultHeaders?.(input.credentials) ?? {}),
    },
    providerName: input.config.providerLabel,
    sanitize: (text) => sanitizeSimpleRestText(text, input.credentials),
  });
}

function sanitizeSimpleRestText(
  text: string,
  credentials: SimpleRestCredentials
): string {
  let sanitized = text;
  for (const value of Object.values(credentials)) {
    if (typeof value === "string" && value.length > 0) {
      sanitized = sanitized.split(value).join("***");
    }
  }
  return sanitized.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function parseSimpleRestContinuationState(
  continuation: SourceApiContinuationState | undefined
): SimpleRestContinuationState | undefined {
  if (continuation === undefined) {
    return undefined;
  }
  if (!isRecord(continuation) || !isRecord(continuation.params)) {
    throw new SimpleRestInvalidRequestError(
      "Invalid source API continuation token state"
    );
  }

  return {
    params: continuation.params as JsonObject,
  };
}

function buildSimpleRestExecutionResponse<
  TCredentials extends SimpleRestCredentials,
>(input: {
  config: SimpleRestAdapterConfig<TCredentials>;
  operation: string;
  response: SimpleRestTransportResponse;
  selector: string;
  source: PreparedSourceConnection;
}): SourceApiExecutionResult {
  const nextContinuationState = input.config.readNextContinuationState?.(
    input.response.body
  );

  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames:
        input.config.allowedResponseHeaders ??
        SIMPLE_REST_ALLOWED_RESPONSE_HEADERS,
      contentType: input.response.contentType,
      headers: input.response.headers,
    }),
    nextContinuationState,
    operation: input.operation,
    selector: input.selector,
    source: {
      displayName: input.source.displayName,
      sourceKey: input.source.sourceKey,
      provider: input.source.provider,
    },
    status: input.response.status,
  };
}
