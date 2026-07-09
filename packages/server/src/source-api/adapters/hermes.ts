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
const HERMES_DEFAULT_RUN_ENDPOINT = "/v1/runs";
const HERMES_ALLOWED_REQUEST_HEADERS = [
  "Content-Type",
  "Idempotency-Key",
  "X-Request-ID",
  "X-Hermes-Session-Key",
] as const;
const HERMES_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "location",
  "retry-after",
  "x-request-id",
  "x-hermes-session-key",
] as const;

const hermesConversationMessageSchema = z.object({
  content: z.string().trim().min(1),
  role: z.string().trim().min(1),
});
const hermesInputSchema = z.union([
  z.string().trim().min(1),
  z.array(z.looseObject({})).min(1),
]);
const hermesTaskRequestSchema = z.looseObject({
  conversationHistory: z.array(hermesConversationMessageSchema).optional(),
  conversation_history: z.array(hermesConversationMessageSchema).optional(),
  input: hermesInputSchema.optional(),
  instructions: z.string().trim().min(1).optional(),
  previousResponseId: z.string().trim().min(1).optional(),
  previous_response_id: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1).optional(),
  sessionKey: z.string().trim().min(1).max(256).optional(),
  session_id: z.string().trim().min(1).optional(),
  task: z.string().trim().min(1).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
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
            "The request body is converted to Hermes Agent's `POST /v1/runs` JSON shape.",
            "Use `task` for a simple task string, or `input` for a native Hermes run input.",
            "Use `sessionId` for Hermes `session_id`; use `sessionKey` for the `X-Hermes-Session-Key` header.",
            "Use `timeoutMs` for the local HTTP request timeout; it is not forwarded to Hermes.",
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
      request: withDefaultHermesRunContext({
        credentials,
        request: normalizedRequest,
      }) as JsonObject,
      selectorTemplate: hermesRunEndpoint(credentials),
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
    const request = withDefaultHermesRunContext({
      credentials,
      request: parseHermesTaskRequest(prepared.request),
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
  const headers = buildHermesRunHeaders({
    credentials: input.credentials,
    headers: input.headers,
    request: input.request,
  });
  const response = await createHermesHttpClient(input.credentials).send({
    body: buildHermesRunPayload({
      credentials: input.credentials,
      request: input.request,
    }),
    endpoint: hermesRunEndpoint(input.credentials),
    headers,
    method: "POST",
    timeoutMs: input.request.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

function buildHermesExamples(
  source: PreparedSourceConnection
): SourceApiExample[] {
  return [
    {
      command: `onequery api --source ${source.sourceKey} --op run_task --input '{"task":"Investigate why the production API is returning 500s","sessionId":"production-api"}'`,
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
  return Boolean(request.task || request.input);
}

function withDefaultHermesRunContext(input: {
  credentials: HermesCredentials;
  request: HermesTaskRequest;
}): HermesTaskRequest {
  let request = input.request;
  const defaultSessionId =
    input.credentials.sessionId ?? input.credentials.workspaceId;

  if (!request.sessionId && !request.session_id && defaultSessionId) {
    request = {
      ...request,
      sessionId: defaultSessionId,
    };
  }

  if (!request.sessionKey && input.credentials.sessionKey) {
    request = {
      ...request,
      sessionKey: input.credentials.sessionKey,
    };
  }

  return request;
}

function buildHermesRunPayload(input: {
  credentials: HermesCredentials;
  request: HermesTaskRequest;
}): JsonObject {
  const request = withDefaultHermesRunContext(input);
  const payload: Record<string, unknown> = {
    input: request.input ?? request.task,
  };
  const sessionId = request.session_id ?? request.sessionId;
  const previousResponseId =
    request.previous_response_id ?? request.previousResponseId;
  const conversationHistory =
    request.conversation_history ?? request.conversationHistory;

  if (request.instructions) {
    payload.instructions = request.instructions;
  }
  if (sessionId) {
    payload.session_id = sessionId;
  }
  if (previousResponseId) {
    payload.previous_response_id = previousResponseId;
  }
  if (conversationHistory) {
    payload.conversation_history = conversationHistory;
  }

  return payload as JsonObject;
}

function buildHermesRunHeaders(input: {
  credentials: HermesCredentials;
  headers?: Record<string, string>;
  request: HermesTaskRequest;
}): Record<string, string> | undefined {
  const sessionKey = input.request.sessionKey ?? input.credentials.sessionKey;
  if (!sessionKey) {
    return input.headers;
  }

  const headers = { ...(input.headers ?? {}) };
  if (!hasHeader(headers, "X-Hermes-Session-Key")) {
    headers["X-Hermes-Session-Key"] = sessionKey;
  }
  return headers;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some(
    (candidate) => candidate.toLowerCase() === name.toLowerCase()
  );
}

function hermesRunEndpoint(credentials: HermesCredentials): string {
  const endpoint =
    credentials.taskEndpoint?.trim() ?? HERMES_DEFAULT_RUN_ENDPOINT;
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
