import type { JsonObject } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { HermesCredentials } from "@onequery/db/server";
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
  toHeaderRecord,
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

const HERMES_DESCRIPTOR_VERSION = "hermes.v1";
const HERMES_DEFAULT_TASK_ENDPOINT = "/api/tasks";
const HERMES_ALLOWED_REQUEST_HEADERS = [
  "Content-Type",
  "Idempotency-Key",
  "X-Request-ID",
] as const;
const HERMES_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "location",
  "retry-after",
  "x-request-id",
] as const;

const hermesTaskRequestSchema = z.looseObject({
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
  workspaceId: z.string().trim().min(1).optional(),
});

type HermesTaskRequest = z.infer<typeof hermesTaskRequestSchema>;

type HermesTransportResponse = Awaited<
  ReturnType<typeof readSourceApiHttpTransportResponse>
>;

export class HermesInvalidRequestError extends SourceApiInvalidRequestError {}

export const hermesSourceApiAdapter: SourceApiAdapter = {
  provider: "hermes",
  async describe({ source }) {
    const examples = buildHermesExamples(source);

    return {
      descriptorVersion: HERMES_DESCRIPTOR_VERSION,
      examples,
      notes: [
        "Hermes requests dispatch work to a connected worker agent.",
        "The Hermes API key stays server-side in the source credentials.",
      ],
      operations: [
        createStructuredRequestOperation({
          allowedRequestHeaders: HERMES_ALLOWED_REQUEST_HEADERS,
          allowedResponseHeaders: HERMES_ALLOWED_RESPONSE_HEADERS,
          description: "Create one task for the connected Hermes worker agent.",
          examples,
          name: "run_task",
          notes: [
            "The request body is forwarded to Hermes as JSON.",
            "Use `timeoutMs` for the local HTTP request timeout; it is not forwarded to Hermes.",
            "If this source has a default `workspaceId`, it is added when the request does not include one.",
          ],
          summary: "Run a task through Hermes.",
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
    const operation = requireHermesOperation({
      descriptor,
      operationName: request.operation,
    });

    if (request.selector?.trim()) {
      throw new HermesInvalidRequestError(
        `Hermes operation "${operation.name}" does not accept a selector`
      );
    }
    if (request.methodOverride?.trim()) {
      throw new HermesInvalidRequestError(
        `Hermes operation "${operation.name}" does not support method overrides`
      );
    }

    const headers = normalizeAllowedHeaders({
      allowedNames: operation.headerPolicy.allowedRequestHeaders,
      headers: request.headers,
    });
    const normalizedRequest = parseHermesTaskRequest(
      mergeStructuredFieldPatch({
        base: parseHermesRequestBody(request.body),
        patch: request.fieldPatch,
      })
    );
    const credentials = requireHermesCredentials(source);

    return {
      body: request.body,
      descriptorVersion: descriptor.descriptorVersion,
      headers,
      kind: "structured_request",
      method: "POST",
      operation: operation.name,
      paginationPolicy: operation.paginationPolicy,
      provider: source.provider,
      request: withDefaultWorkspaceId({
        request: normalizedRequest,
        workspaceId: credentials.workspaceId,
      }) as JsonObject,
      selectorTemplate: hermesTaskEndpoint(credentials),
      sourceId: source.id,
      sourceKey: source.sourceKey,
    };
  },
  async execute({ prepared, source }) {
    if (prepared.kind !== "structured_request") {
      throw new Error(
        `Hermes operation "${prepared.operation}" requires a structured plan`
      );
    }

    const credentials = requireHermesCredentials(source);
    const request = withDefaultWorkspaceId({
      request: parseHermesTaskRequest(prepared.request),
      workspaceId: credentials.workspaceId,
    });
    const response = await requestHermesTask({
      credentials,
      headers: toHeaderRecord(prepared.headers),
      request,
    });

    return buildHermesExecutionResponse({
      operation: prepared.operation,
      response,
      source,
    });
  },
};

export function isHermesCredentials(
  value: unknown
): value is HermesCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "hermes"
  );
}

export async function requestHermesTask(input: {
  credentials: HermesCredentials;
  headers?: Record<string, string>;
  request: HermesTaskRequest;
}): Promise<HermesTransportResponse> {
  const response = await createHermesHttpClient(input.credentials).send({
    body: stripHermesLocalRequestFields(input.request),
    endpoint: hermesTaskEndpoint(input.credentials),
    headers: input.headers,
    method: "POST",
    timeoutMs: input.request.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

function buildHermesExamples(
  source: PreparedSourceConnection
): SourceApiExample[] {
  const credentials = isHermesCredentials(source.credentials)
    ? source.credentials
    : null;
  const workspaceField = credentials?.workspaceId
    ? ""
    : ',"workspaceId":"workspace_123"';

  return [
    {
      command: `onequery api --source ${source.sourceKey} --op run_task --input '{"task":"Investigate why the production API is returning 500s"${workspaceField}}'`,
      description:
        "Dispatch a debugging task to the connected Hermes worker agent.",
      label: "Run debugging task",
    },
  ];
}

function requireHermesOperation(input: {
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

function requireHermesCredentials(
  source: PreparedSourceConnection
): HermesCredentials {
  if (isHermesCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("Hermes source credentials are invalid");
}

function parseHermesRequestBody(body: SourceApiRequestBody): JsonObject {
  switch (body.kind) {
    case "none":
      return {};
    case "json":
      if (isRecord(body.value)) {
        return body.value;
      }
      throw new HermesInvalidRequestError(
        "Hermes task requests must be JSON objects"
      );
    case "text":
    case "binary":
      throw new HermesInvalidRequestError(
        "Hermes task requests must be JSON objects"
      );
  }
}

function parseHermesTaskRequest(value: JsonObject): HermesTaskRequest {
  const parsed = hermesTaskRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new HermesInvalidRequestError("Invalid Hermes task request");
  }

  if (!hasHermesTaskPayloadField(parsed.data)) {
    throw new HermesInvalidRequestError(
      "Hermes task request must include at least one task payload field"
    );
  }

  return parsed.data;
}

function hasHermesTaskPayloadField(request: HermesTaskRequest): boolean {
  return Object.keys(request).some(
    (key) => key !== "timeoutMs" && key !== "workspaceId"
  );
}

function withDefaultWorkspaceId(input: {
  request: HermesTaskRequest;
  workspaceId?: string;
}): HermesTaskRequest {
  if (!input.workspaceId || input.request.workspaceId) {
    return input.request;
  }

  return {
    ...input.request,
    workspaceId: input.workspaceId,
  };
}

function stripHermesLocalRequestFields(request: HermesTaskRequest): JsonObject {
  const { timeoutMs: _timeoutMs, ...payload } = request;
  return payload as JsonObject;
}

function hermesTaskEndpoint(credentials: HermesCredentials): string {
  const endpoint =
    credentials.taskEndpoint?.trim() ?? HERMES_DEFAULT_TASK_ENDPOINT;
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    throw new HermesInvalidRequestError(
      "Hermes taskEndpoint must be a relative path"
    );
  }
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function createHermesHttpClient(credentials: HermesCredentials) {
  return new ProviderHttpClient({
    auth: {
      token: credentials.apiKey,
      type: "bearer",
    },
    baseUrl: credentials.apiBaseUrl,
    defaultHeaders: {
      "Content-Type": "application/json",
    },
    providerName: "Hermes",
    sanitize: sanitizeHermesError,
  });
}

function sanitizeHermesError(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [REDACTED]")
    .slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function buildHermesExecutionResponse(input: {
  source: PreparedSourceConnection;
  operation: string;
  response: HermesTransportResponse;
}): SourceApiExecutionResult {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: HERMES_ALLOWED_RESPONSE_HEADERS,
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
