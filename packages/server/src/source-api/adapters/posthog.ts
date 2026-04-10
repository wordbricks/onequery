import { isRecord } from "@onequery/base";
import type { PostHogCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
  MAX_PROVIDER_REQUEST_TIMEOUT_MS,
} from "../../services/provider-http";
import { ProviderHttpClient } from "../../services/provider-http-client";
import { hasControlCharacters } from "../../services/provider-utils";
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
  SourceApiExecutionResponse,
  SourceApiOperation,
  SourceApiRequestBody,
} from "../types";

const POSTHOG_DESCRIPTOR_VERSION = "posthog.v1";
const POSTHOG_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;

export const postHogSourceApiOperationSchema = z.enum(["run_query"]);

export type PostHogSourceApiOperation = z.infer<
  typeof postHogSourceApiOperationSchema
>;

const postHogRunQueryRequestSchema = z
  .object({
    query: z.record(z.string(), z.unknown()),
    refresh: z.string().min(1).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
      .optional(),
  })
  .strict();

export type PostHogRunQueryRequest = z.infer<
  typeof postHogRunQueryRequestSchema
>;

export type PostHogTransportResponse = Awaited<
  ReturnType<typeof readSourceApiHttpTransportResponse>
>;

export class PostHogInvalidRequestError extends SourceApiInvalidRequestError {}

export const postHogSourceApiAdapter: SourceApiAdapter = {
  provider: "posthog",
  async describe({ source }) {
    const examples = buildPostHogExamples(source.sourceKey);

    return {
      descriptorVersion: POSTHOG_DESCRIPTOR_VERSION,
      examples,
      notes: [
        "PostHog query requests run against the project saved on the connected source.",
      ],
      operations: [
        createStructuredRequestOperation({
          allowedResponseHeaders: POSTHOG_ALLOWED_RESPONSE_HEADERS,
          description: "Run a PostHog query for the connected source.",
          examples,
          name: "run_query",
          notes: ["Request fields match the PostHog `/query/` payload."],
          summary: "Execute one PostHog query.",
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
    const operation = requirePostHogSourceApiOperation({
      descriptor,
      operationName: request.operation,
    });

    if (request.pageToken) {
      throw new PostHogInvalidRequestError(
        `PostHog operation "${operation.name}" does not support page tokens`
      );
    }
    if (request.selector?.trim()) {
      throw new PostHogInvalidRequestError(
        `PostHog operation "${operation.name}" does not accept a selector`
      );
    }
    if (request.methodOverride?.trim()) {
      throw new PostHogInvalidRequestError(
        `PostHog operation "${operation.name}" does not support method overrides`
      );
    }

    const headers = normalizeAllowedHeaders({
      allowedNames: operation.headerPolicy.allowedRequestHeaders,
      headers: request.headers,
    });
    const normalizedRequest = parsePostHogRunQueryRequest(
      mergeStructuredFieldPatch({
        base: parsePostHogRequestBody(request.body),
        patch: request.fieldPatch,
      })
    );

    return {
      body: request.body,
      descriptorVersion: descriptor.descriptorVersion,
      headers,
      kind: "structured_request",
      method: "POST",
      operation: operation.name,
      provider: source.provider,
      request: normalizedRequest,
      selectorTemplate: "/api/projects/{projectId}/query/",
      sourceId: source.id,
      sourceKey: source.sourceKey,
    };
  },
  async execute({ plan, source }) {
    if (plan.kind !== "structured_request") {
      throw new Error(
        `PostHog source API operation "${plan.operation}" requires a structured plan`
      );
    }

    const response = await requestPostHogSourceApi({
      credentials: requirePostHogCredentials(source),
      request: parsePostHogRunQueryRequest(plan.request),
    });

    return buildPostHogExecutionResponse({
      operation: plan.operation,
      response,
      source,
    });
  },
};

export function isPostHogSourceCredentials(
  value: unknown
): value is PostHogCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "posthog"
  );
}

export async function requestPostHogSourceApi(input: {
  credentials: PostHogCredentials;
  request: PostHogRunQueryRequest;
}): Promise<PostHogTransportResponse> {
  const response = await createPostHogHttpClient(input.credentials).send({
    body: buildPostHogRequestPayload(input.request),
    endpoint: buildPostHogProjectUrl({
      credentials: input.credentials,
      endpoint: "/query/",
    }),
    method: "POST",
    timeoutMs: input.request.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

function buildPostHogExamples(sourceKey: string): SourceApiExample[] {
  return [
    {
      command: `onequery use --source ${sourceKey} --op run_query --input '{"query":{"kind":"TrendsQuery","series":[{"event":"Signup"}],"dateRange":{"date_from":"-7d"}}}'`,
      description: "Run a PostHog trends query against the connected project.",
      label: "Run trends query",
    },
  ];
}

function requirePostHogSourceApiOperation(input: {
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

function requirePostHogCredentials(
  source: PreparedSourceConnection
): PostHogCredentials {
  if (isPostHogSourceCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("PostHog source credentials are invalid");
}

function parsePostHogRequestBody(
  body: SourceApiRequestBody
): Record<string, unknown> {
  switch (body.kind) {
    case "none":
      return {};
    case "json":
      if (!isRecord(body.value)) {
        throw new PostHogInvalidRequestError(
          "PostHog requests require a JSON object request body"
        );
      }
      return body.value;
    case "text":
    case "binary":
      throw new PostHogInvalidRequestError(
        "PostHog requests require a JSON object request body"
      );
  }
}

function parsePostHogRunQueryRequest(value: unknown): PostHogRunQueryRequest {
  const parsed = postHogRunQueryRequestSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new PostHogInvalidRequestError(
    "Invalid PostHog run_query request payload"
  );
}

function sanitizePostHogText(
  text: string,
  credentials: PostHogCredentials
): string {
  if (credentials.personalApiKey.length === 0) {
    return text.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
  }
  return text
    .split(credentials.personalApiKey)
    .join("***")
    .slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function normalizePostHogBaseUrl(hostUrl: string): string {
  const url = new URL(hostUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PostHogInvalidRequestError(
      "PostHog host URL must use http or https"
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new PostHogInvalidRequestError(
      "PostHog host URL must not include URL credentials"
    );
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new PostHogInvalidRequestError(
      "PostHog host URL must not include query params or fragments"
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    // Comment: This relay still assumes root-relative project API paths.
    throw new PostHogInvalidRequestError(
      "PostHog host URL must not include a path"
    );
  }
  return url.origin;
}

function normalizeProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new PostHogInvalidRequestError("PostHog project ID is required");
  }
  return normalized;
}

function normalizePersonalApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new PostHogInvalidRequestError(
      "PostHog personal API key is required"
    );
  }
  return normalized;
}

function normalizeRefresh(refresh: string | undefined): string | undefined {
  if (refresh === undefined) {
    return undefined;
  }
  const normalized = refresh.trim();
  if (normalized.length === 0) {
    throw new PostHogInvalidRequestError("PostHog refresh must not be empty");
  }
  if (hasControlCharacters(normalized)) {
    throw new PostHogInvalidRequestError(
      "PostHog refresh must not contain control characters"
    );
  }
  return normalized;
}

function buildPostHogProjectUrl(input: {
  credentials: PostHogCredentials;
  endpoint: string;
}): string {
  const baseUrl = normalizePostHogBaseUrl(input.credentials.hostUrl);
  const projectId = normalizeProjectId(input.credentials.projectId);
  const normalizedEndpoint = input.endpoint.startsWith("/")
    ? input.endpoint
    : `/${input.endpoint}`;

  return new URL(
    `/api/projects/${encodeURIComponent(projectId)}${normalizedEndpoint}`,
    `${baseUrl}/`
  ).toString();
}

function createPostHogHttpClient(credentials: PostHogCredentials) {
  return new ProviderHttpClient({
    auth: {
      token: normalizePersonalApiKey(credentials.personalApiKey),
      type: "bearer",
    },
    baseUrl: normalizePostHogBaseUrl(credentials.hostUrl),
    defaultHeaders: {
      Accept: "application/json",
    },
    providerName: "PostHog",
    sanitize: (text) => sanitizePostHogText(text, credentials),
  });
}

function buildPostHogRequestPayload(
  request: PostHogRunQueryRequest
): Record<string, unknown> {
  return {
    query: request.query,
    ...(request.refresh ? { refresh: normalizeRefresh(request.refresh) } : {}),
  };
}

function buildPostHogExecutionResponse(input: {
  operation: string;
  response: PostHogTransportResponse;
  source: PreparedSourceConnection;
}): SourceApiExecutionResponse {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: POSTHOG_ALLOWED_RESPONSE_HEADERS,
      contentType: input.response.contentType,
      headers: input.response.headers,
    }),
    operation: input.operation,
    source: {
      displayName: input.source.displayName,
      key: input.source.sourceKey,
      provider: input.source.provider,
    },
    status: input.response.status,
  };
}
