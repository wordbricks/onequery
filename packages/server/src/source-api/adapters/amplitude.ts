import type { JsonObject } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { AmplitudeCredentials } from "@onequery/db/server";
import { z } from "zod";

import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
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
  PreparedHttpSourceApi,
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResult,
  SourceApiOperation,
  SourceApiRequestBody,
} from "../types";

const AMPLITUDE_API_BASE_URLS = {
  eu: "https://analytics.eu.amplitude.com",
  us: "https://amplitude.com",
} as const;
const AMPLITUDE_DESCRIPTOR_VERSION = "amplitude.v1";
const AMPLITUDE_ALLOWED_METHODS = ["DELETE", "GET", "POST", "PUT"] as const;
const AMPLITUDE_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;

export const amplitudeSourceApiOperationSchema = z.enum(["fetch_api"]);

export type AmplitudeSourceApiOperation = z.infer<
  typeof amplitudeSourceApiOperationSchema
>;

const amplitudeFieldPatchSchema = z
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

type AmplitudeFieldPatch = z.infer<typeof amplitudeFieldPatchSchema>;

export type AmplitudeTransportResponse = Awaited<
  ReturnType<typeof readSourceApiHttpTransportResponse>
>;

export class AmplitudeInvalidRequestError extends SourceApiInvalidRequestError {}

export const amplitudeSourceApiAdapter: SourceApiAdapter = {
  provider: "amplitude",
  async describe({ source }) {
    const examples = buildAmplitudeExamples(source.sourceKey);

    return {
      defaultPathOperation: "fetch_api",
      descriptorVersion: AMPLITUDE_DESCRIPTOR_VERSION,
      examples,
      notes: [
        "Use the selector for the Amplitude REST path and `params` in the field patch for query string values.",
      ],
      operations: [
        createHttpRequestOperation({
          allowedMethods: AMPLITUDE_ALLOWED_METHODS,
          allowedResponseHeaders: AMPLITUDE_ALLOWED_RESPONSE_HEADERS,
          defaultMethod: "GET",
          description:
            "Call an Amplitude REST endpoint for the connected source.",
          examples,
          name: "fetch_api",
          notes: [
            "Amplitude selectors must be relative REST paths such as `/2/events/segmentation`.",
            "Amplitude request bodies must be JSON objects.",
          ],
          selectorKind: "path",
          selectorLabel: "PATH",
          summary: "Execute one Amplitude API request.",
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
    const operation = requireAmplitudeSourceApiOperation({
      descriptor,
      operationName: request.operation,
    });

    const selector = normalizeAmplitudeSelector(request.selector);
    const fieldPatch = parseAmplitudeFieldPatch(request.fieldPatch);
    const method = resolveHttpMethodOverride({
      methodOverride: request.methodOverride,
      policy: operation.methodPolicy,
    });
    if (request.body.kind !== "none" && method === "GET") {
      throw new AmplitudeInvalidRequestError(
        "GET requests cannot include a request body"
      );
    }

    validateAmplitudeRequestBody(request.body);

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
      url: buildAmplitudeUrl({
        credentials: requireAmplitudeCredentials(source),
        endpoint: selector,
        params: fieldPatch.params,
      }),
    };
  },
  async execute({ prepared, source }) {
    if (prepared.kind !== "http_request") {
      throw new Error(
        `Amplitude source API operation "${prepared.operation}" requires an HTTP plan`
      );
    }

    const selector = normalizeAmplitudePlanSelector(prepared);
    const response = await requestAmplitudeSourceApi({
      body: prepared.body,
      credentials: requireAmplitudeCredentials(source),
      method: prepared.method,
      params: prepared.query,
      selector,
      timeoutMs: prepared.timeoutMs,
    });

    return buildAmplitudeExecutionResponse({
      operation: prepared.operation,
      response,
      selector,
      source,
    });
  },
};

export function isAmplitudeSourceCredentials(
  value: unknown
): value is AmplitudeCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "amplitude"
  );
}

export async function requestAmplitudeSourceApi(input: {
  body: SourceApiRequestBody;
  credentials: AmplitudeCredentials;
  method: string;
  params?: Record<string, unknown>;
  selector: string;
  timeoutMs?: number;
}): Promise<AmplitudeTransportResponse> {
  const response = await createAmplitudeHttpClient(input.credentials).send({
    body: buildAmplitudeRequestBody({
      body: input.body,
      method: input.method,
    }),
    endpoint: buildAmplitudeUrl({
      credentials: input.credentials,
      endpoint: input.selector,
      params: input.params,
    }),
    method: input.method,
    timeoutMs: input.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

export function buildAmplitudeUrl(input: {
  credentials: AmplitudeCredentials;
  endpoint: string;
  params?: Record<string, unknown>;
}): string {
  const url = new URL(
    normalizeAmplitudeSelector(input.endpoint),
    `${AMPLITUDE_API_BASE_URLS[input.credentials.region]}/`
  );

  for (const [key, value] of Object.entries(input.params ?? {})) {
    const serialized = serializeQueryParam(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }

  return url.toString();
}

function buildAmplitudeExamples(sourceKey: string): SourceApiExample[] {
  return [
    {
      command: `onequery api --source ${sourceKey} /2/events/segmentation -f 'params[e]=[{"event_type":"Signup"}]' -f params[start]=2026-03-01 -f params[end]=2026-03-07`,
      description:
        "Run an Amplitude segmentation request against the connected source.",
      label: "Fetch event segmentation",
    },
  ];
}

function requireAmplitudeSourceApiOperation(input: {
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

function parseAmplitudeFieldPatch(
  value: Record<string, unknown> | undefined
): AmplitudeFieldPatch {
  if (!value) {
    return {};
  }

  const parsed = amplitudeFieldPatchSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new AmplitudeInvalidRequestError("Invalid Amplitude field patch");
}

function requireAmplitudeCredentials(
  source: PreparedSourceConnection
): AmplitudeCredentials {
  if (isAmplitudeSourceCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("Amplitude source credentials are invalid");
}

function normalizeAmplitudePlanSelector(plan: PreparedHttpSourceApi): string {
  const selector = plan.selector?.trim();
  if (selector) {
    return selector;
  }

  throw new Error(
    `Amplitude source API operation "${plan.operation}" requires a selector`
  );
}

function normalizeAmplitudeSelector(selector: string | undefined): string {
  const normalized = selector?.trim();
  if (!normalized) {
    throw new AmplitudeInvalidRequestError(
      'Amplitude operation "fetch_api" requires a selector'
    );
  }
  if (
    hasControlCharacters(normalized) ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.includes("?") ||
    normalized.includes("#")
  ) {
    throw new AmplitudeInvalidRequestError(
      "Amplitude selectors must be relative paths without query params or fragments"
    );
  }

  const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new AmplitudeInvalidRequestError(
      "Amplitude selectors must not contain dot segments"
    );
  }

  return path;
}

function validateAmplitudeRequestBody(body: SourceApiRequestBody): void {
  switch (body.kind) {
    case "none":
      return;
    case "json":
      if (!isRecord(body.value)) {
        throw new AmplitudeInvalidRequestError(
          "Amplitude request bodies must be JSON objects"
        );
      }
      return;
    case "text":
    case "binary":
      throw new AmplitudeInvalidRequestError(
        "Amplitude request bodies must be JSON objects"
      );
  }
}

function buildAmplitudeRequestBody(input: {
  body: SourceApiRequestBody;
  method: string;
}): Record<string, unknown> | undefined {
  const parsedBody = parseAmplitudeJsonObjectBody(input.body);
  if (!parsedBody || input.method === "GET") {
    return undefined;
  }

  return parsedBody;
}

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
    baseUrl: AMPLITUDE_API_BASE_URLS[credentials.region],
    defaultHeaders: {
      Accept: "application/json",
    },
    providerName: "Amplitude",
    sanitize: (text) => sanitizeAmplitudeText(text, credentials),
  });
}

function parseAmplitudeJsonObjectBody(
  body: SourceApiRequestBody
): Record<string, unknown> | undefined {
  validateAmplitudeRequestBody(body);
  if (body.kind === "none") {
    return undefined;
  }

  return body.value as Record<string, unknown>;
}

function buildAmplitudeExecutionResponse(input: {
  operation: string;
  response: AmplitudeTransportResponse;
  selector: string;
  source: PreparedSourceConnection;
}): SourceApiExecutionResult {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: AMPLITUDE_ALLOWED_RESPONSE_HEADERS,
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
