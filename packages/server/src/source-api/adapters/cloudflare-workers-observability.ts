import type { JsonObject } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { CloudflareWorkersObservabilityCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
  MAX_PROVIDER_REQUEST_TIMEOUT_MS,
} from "../../services/provider-http";
import { ProviderHttpClient } from "../../services/provider-http-client";
import {
  SourceApiInvalidRequestError,
  SourceApiUnsupportedOperationError,
} from "../errors";
import {
  filterAllowedResponseHeaders,
  normalizeAllowedHeaders,
  readSourceApiHttpTransportResponse,
} from "../helpers/http-rest";
import {
  createStructuredRequestOperation,
  mergeStructuredFieldPatch,
} from "../helpers/structured";
import type {
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResult,
  SourceApiOperation,
  SourceApiRequestBody,
} from "../types";

const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_WORKERS_OBSERVABILITY_DESCRIPTOR_VERSION =
  "cloudflare-workers-observability.v1";
const CLOUDFLARE_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;

export const cloudflareWorkersObservabilitySourceApiOperationSchema = z.enum([
  "list_keys",
  "list_values",
  "run_query",
]);

export type CloudflareWorkersObservabilitySourceApiOperation = z.infer<
  typeof cloudflareWorkersObservabilitySourceApiOperationSchema
>;

const telemetryTimeframeSchema = z
  .object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  })
  .strict();

const cloudflareTelemetryRequestSchema = z.looseObject({
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
});

const cloudflareRunQueryRequestSchema = cloudflareTelemetryRequestSchema
  .extend({
    queryId: z.string().trim().min(1),
    timeframe: telemetryTimeframeSchema,
  })
  .loose();

const cloudflareListKeysRequestSchema = cloudflareTelemetryRequestSchema
  .extend({
    timeframe: telemetryTimeframeSchema.optional(),
  })
  .loose();

const cloudflareListValuesRequestSchema = cloudflareTelemetryRequestSchema
  .extend({
    key: z.string().trim().min(1),
    timeframe: telemetryTimeframeSchema,
    type: z.enum(["string", "boolean", "number"]),
  })
  .loose();

type CloudflareTelemetryRequest = z.infer<
  typeof cloudflareTelemetryRequestSchema
>;

export type CloudflareWorkersObservabilityTransportResponse = Awaited<
  ReturnType<typeof readSourceApiHttpTransportResponse>
>;

export class CloudflareWorkersObservabilityInvalidRequestError extends SourceApiInvalidRequestError {}

export const cloudflareWorkersObservabilitySourceApiAdapter: SourceApiAdapter =
  {
    provider: "cloudflare_workers_observability",
    async describe({ source }) {
      const examples = buildCloudflareWorkersObservabilityExamples(source);

      return {
        descriptorVersion: CLOUDFLARE_WORKERS_OBSERVABILITY_DESCRIPTOR_VERSION,
        examples,
        notes: [
          "Workers Logs must be enabled in the Worker Wrangler configuration before telemetry appears.",
          "Requests run against the Cloudflare account saved on this source.",
        ],
        operations: [
          createStructuredRequestOperation({
            allowedResponseHeaders: CLOUDFLARE_ALLOWED_RESPONSE_HEADERS,
            description:
              "Discover indexed field keys available in Workers Observability telemetry.",
            examples: examples.filter(
              (example) => example.label === "List keys"
            ),
            name: "list_keys",
            notes: [
              "Request fields match the Cloudflare telemetry keys endpoint payload.",
            ],
            summary: "List Workers Observability telemetry keys.",
          }),
          createStructuredRequestOperation({
            allowedResponseHeaders: CLOUDFLARE_ALLOWED_RESPONSE_HEADERS,
            description:
              "List values for one Workers Observability telemetry field.",
            examples: examples.filter(
              (example) => example.label === "List services"
            ),
            name: "list_values",
            notes: [
              "Use `list_keys` first when you need to discover valid field names and types.",
            ],
            summary: "List telemetry values for a field.",
          }),
          createStructuredRequestOperation({
            allowedResponseHeaders: CLOUDFLARE_ALLOWED_RESPONSE_HEADERS,
            description:
              "Run an ad-hoc Cloudflare Workers Observability telemetry query.",
            examples: examples.filter(
              (example) => example.label === "Recent events"
            ),
            name: "run_query",
            notes: [
              "The request body matches Cloudflare's telemetry query payload.",
              "Use `dry: true` for exploratory validation queries.",
            ],
            summary: "Run one Workers Observability telemetry query.",
          }),
        ],
        source: {
          displayName: source.displayName,
          provider: source.provider,
          sourceKey: source.sourceKey,
        },
      };
    },
    async normalize({ descriptor, request, source }) {
      const operation = requireCloudflareWorkersObservabilityOperation({
        descriptor,
        operationName: request.operation,
      });

      if (request.selector?.trim()) {
        throw new CloudflareWorkersObservabilityInvalidRequestError(
          `Cloudflare Workers Observability operation "${operation.name}" does not accept a selector`
        );
      }
      if (request.methodOverride?.trim()) {
        throw new CloudflareWorkersObservabilityInvalidRequestError(
          `Cloudflare Workers Observability operation "${operation.name}" does not support method overrides`
        );
      }

      const headers = normalizeAllowedHeaders({
        allowedNames: operation.headerPolicy.allowedRequestHeaders,
        headers: request.headers,
      });
      const normalizedRequest = parseCloudflareTelemetryRequest({
        operation: operation.name,
        value: mergeStructuredFieldPatch({
          base: parseCloudflareRequestBody(request.body),
          patch: request.fieldPatch,
        }),
      });

      return {
        body: request.body,
        descriptorVersion: descriptor.descriptorVersion,
        headers,
        kind: "structured_request",
        method: "POST",
        operation: operation.name,
        paginationPolicy: operation.paginationPolicy,
        provider: source.provider,
        request: normalizedRequest as JsonObject,
        selectorTemplate: cloudflareTelemetrySelectorTemplate(operation.name),
        sourceId: source.id,
        sourceKey: source.sourceKey,
      };
    },
    async execute({ prepared, source }) {
      if (prepared.kind !== "structured_request") {
        throw new Error(
          `Cloudflare Workers Observability operation "${prepared.operation}" requires a structured plan`
        );
      }

      const request = parseCloudflareTelemetryRequest({
        operation: prepared.operation,
        value: prepared.request,
      });
      const response = await requestCloudflareWorkersObservabilitySourceApi({
        credentials: requireCloudflareWorkersObservabilityCredentials(source),
        operation: prepared.operation,
        request,
      });

      return buildCloudflareWorkersObservabilityExecutionResponse({
        operation: prepared.operation,
        response,
        source,
      });
    },
  };

export function isCloudflareWorkersObservabilityCredentials(
  value: unknown
): value is CloudflareWorkersObservabilityCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "cloudflare_workers_observability"
  );
}

export async function requestCloudflareWorkersObservabilitySourceApi(input: {
  credentials: CloudflareWorkersObservabilityCredentials;
  operation: string;
  request: CloudflareTelemetryRequest;
}): Promise<CloudflareWorkersObservabilityTransportResponse> {
  const response = await createCloudflareHttpClient(input.credentials).send({
    body: stripCloudflareLocalRequestFields(input.request),
    endpoint: buildCloudflareTelemetryUrl({
      accountId: input.credentials.accountId,
      apiBaseUrl: input.credentials.apiBaseUrl ?? CLOUDFLARE_API_BASE_URL,
      operation: input.operation,
    }),
    method: "POST",
    timeoutMs: input.request.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

function buildCloudflareWorkersObservabilityExamples(
  source: PreparedSourceConnection
): SourceApiExample[] {
  const credentials = isCloudflareWorkersObservabilityCredentials(
    source.credentials
  )
    ? source.credentials
    : null;
  const scriptFilter = credentials?.scriptName
    ? `,"filters":[{"key":"$metadata.service","operation":"eq","type":"string","value":"${credentials.scriptName}"}]`
    : "";

  return [
    {
      command: `onequery api --source ${source.sourceKey} --op list_keys --input '{"datasets":["cloudflare-workers"]}'`,
      description: "Discover fields available in Workers Observability logs.",
      label: "List keys",
    },
    {
      command: `onequery api --source ${source.sourceKey} --op list_values --input '{"datasets":["cloudflare-workers"],"key":"$metadata.service","type":"string","timeframe":{"from":0,"to":0},"limit":50}'`,
      description: "List Worker service names visible in telemetry.",
      label: "List services",
    },
    {
      command: `onequery api --source ${source.sourceKey} --op run_query --input '{"queryId":"onequery-recent-events","dry":true,"view":"events","limit":50,"timeframe":{"from":0,"to":0},"parameters":{"datasets":["cloudflare-workers"]${scriptFilter}}}'`,
      description:
        "Run an events query. Replace the timeframe values with Unix timestamps in milliseconds.",
      label: "Recent events",
    },
  ];
}

function requireCloudflareWorkersObservabilityOperation(input: {
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

function requireCloudflareWorkersObservabilityCredentials(
  source: PreparedSourceConnection
): CloudflareWorkersObservabilityCredentials {
  if (isCloudflareWorkersObservabilityCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error(
    "Cloudflare Workers Observability source credentials are invalid"
  );
}

function parseCloudflareRequestBody(body: SourceApiRequestBody): JsonObject {
  switch (body.kind) {
    case "none":
      return {};
    case "json":
      if (isRecord(body.value)) {
        return body.value;
      }
      throw new CloudflareWorkersObservabilityInvalidRequestError(
        "Cloudflare Workers Observability requests must be JSON objects"
      );
    case "text":
    case "binary":
      throw new CloudflareWorkersObservabilityInvalidRequestError(
        "Cloudflare Workers Observability requests must be JSON objects"
      );
  }
}

function parseCloudflareTelemetryRequest(input: {
  operation: string;
  value: JsonObject;
}): CloudflareTelemetryRequest {
  const schema = cloudflareTelemetryRequestSchemaForOperation(input.operation);
  const parsed = schema.safeParse(input.value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new CloudflareWorkersObservabilityInvalidRequestError(
    "Invalid Cloudflare Workers Observability request"
  );
}

function cloudflareTelemetryRequestSchemaForOperation(operation: string) {
  switch (operation) {
    case "list_keys":
      return cloudflareListKeysRequestSchema;
    case "list_values":
      return cloudflareListValuesRequestSchema;
    case "run_query":
      return cloudflareRunQueryRequestSchema;
    default:
      throw new SourceApiUnsupportedOperationError(operation);
  }
}

function buildCloudflareTelemetryUrl(input: {
  accountId: string;
  apiBaseUrl: string;
  operation: string;
}): string {
  const accountId = encodeURIComponent(input.accountId);
  const baseUrl = input.apiBaseUrl.replace(/\/+$/, "");
  const path = cloudflareTelemetryPath(input.operation);
  return `${baseUrl}/accounts/${accountId}/workers/observability/telemetry/${path}`;
}

function cloudflareTelemetryPath(operation: string): string {
  switch (operation) {
    case "list_keys":
      return "keys";
    case "list_values":
      return "values";
    case "run_query":
      return "query";
    default:
      throw new SourceApiUnsupportedOperationError(operation);
  }
}

function cloudflareTelemetrySelectorTemplate(operation: string): string {
  return `/accounts/{accountId}/workers/observability/telemetry/${cloudflareTelemetryPath(
    operation
  )}`;
}

function stripCloudflareLocalRequestFields(
  request: CloudflareTelemetryRequest
): JsonObject {
  const { timeoutMs: _timeoutMs, ...payload } = request;
  return payload as JsonObject;
}

function buildCloudflareWorkersObservabilityExecutionResponse(input: {
  source: PreparedSourceConnection;
  operation: string;
  response: CloudflareWorkersObservabilityTransportResponse;
}): SourceApiExecutionResult {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: CLOUDFLARE_ALLOWED_RESPONSE_HEADERS,
      contentType: input.response.contentType,
      headers: input.response.headers,
    }),
    operation: input.operation,
    source: {
      displayName: input.source.displayName,
      provider: input.source.provider,
      sourceKey: input.source.sourceKey,
    },
    status: input.response.status,
  };
}

function createCloudflareHttpClient(
  credentials: CloudflareWorkersObservabilityCredentials
): ProviderHttpClient {
  return new ProviderHttpClient({
    auth: {
      type: "bearer",
      token: credentials.apiToken,
    },
    baseUrl: credentials.apiBaseUrl ?? CLOUDFLARE_API_BASE_URL,
    defaultHeaders: {
      "Content-Type": "application/json",
    },
    providerName: "Cloudflare Workers Observability",
    sanitize: sanitizeCloudflareError,
  });
}

function sanitizeCloudflareError(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}
