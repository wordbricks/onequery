import { isRecord } from "@onequery/base";
import type { GoogleAnalyticsCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  resolveGoogleAnalyticsAccessToken,
  resolveGoogleAnalyticsPropertyPath,
  runGoogleAnalyticsDataRequest,
} from "../../services/google-analytics/relay";
import {
  filterAllowedResponseHeaders,
  normalizeAllowedHeaders,
  normalizeSourceApiContentType,
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
  SourceApiHeader,
  SourceApiJsonValue,
  SourceApiOperation,
  SourceApiRequestBody,
  SourceApiResponseBody,
} from "../types";

const GOOGLE_ANALYTICS_DESCRIPTOR_VERSION = "ga.v1";
const GOOGLE_ANALYTICS_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;

const googleAnalyticsSourceApiOperationSchema = z.enum([
  "run_report",
  "run_realtime_report",
]);

export type GoogleAnalyticsSourceApiOperation = z.infer<
  typeof googleAnalyticsSourceApiOperationSchema
>;

export class GoogleAnalyticsInvalidRequestError extends Error {}

export class GoogleAnalyticsAccessTokenError extends Error {}

export type GoogleAnalyticsTransportResponse = {
  body: SourceApiResponseBody;
  contentType: string;
  headers: SourceApiHeader[];
  resolvedPropertyPath: string;
  status: number;
};

export const googleAnalyticsSourceApiAdapter: SourceApiAdapter = {
  provider: "ga",
  async describe({ source }) {
    const { examples, realtimeExamples, reportExamples } =
      buildGoogleAnalyticsExamples(source.sourceKey);

    return {
      descriptorVersion: GOOGLE_ANALYTICS_DESCRIPTOR_VERSION,
      examples,
      notes: [
        "If the request omits `property`, OneQuery uses the property saved on the connected source.",
      ],
      operations: [
        createStructuredRequestOperation({
          allowedResponseHeaders: GOOGLE_ANALYTICS_ALLOWED_RESPONSE_HEADERS,
          description:
            "Run a Google Analytics Data API report against the connected source.",
          examples: reportExamples,
          name: "run_report",
          notes: [
            "Request fields match the Google Analytics Data API runReport payload.",
          ],
          summary: "Execute a Google Analytics report query.",
        }),
        createStructuredRequestOperation({
          allowedResponseHeaders: GOOGLE_ANALYTICS_ALLOWED_RESPONSE_HEADERS,
          description:
            "Run a Google Analytics realtime report against the connected source.",
          examples: realtimeExamples,
          name: "run_realtime_report",
          notes: [
            "Request fields match the Google Analytics Data API runRealtimeReport payload.",
          ],
          summary: "Execute a Google Analytics realtime query.",
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
    const operation = requireGoogleAnalyticsSourceApiOperation({
      descriptor,
      operationName: request.operation,
    });

    if (request.pageToken) {
      throw new Error(
        `Google Analytics operation "${operation.name}" does not support page tokens`
      );
    }
    if (request.selector?.trim()) {
      throw new Error(
        `Google Analytics operation "${operation.name}" does not accept a selector`
      );
    }
    if (request.methodOverride?.trim()) {
      throw new Error(
        `Google Analytics operation "${operation.name}" does not support method overrides`
      );
    }

    const headers = normalizeAllowedHeaders({
      allowedNames: operation.headerPolicy.allowedRequestHeaders,
      headers: request.headers,
    });
    const normalizedRequest = normalizeGoogleAnalyticsStructuredRequest({
      body: request.body,
      fieldPatch: request.fieldPatch,
    });
    const credentials = requireGoogleAnalyticsCredentials(source);
    const resolvedPropertyPath = resolveGoogleAnalyticsPropertyPath({
      credentials,
      request: normalizedRequest,
    });
    if (!resolvedPropertyPath) {
      throw new Error(
        "Google Analytics property is required in the request or connected source"
      );
    }

    return {
      body: request.body,
      descriptorVersion: descriptor.descriptorVersion,
      headers,
      kind: "structured_request",
      method: "POST",
      metadata: {
        propertyPath: resolvedPropertyPath,
      },
      operation: operation.name,
      provider: source.provider,
      request: {
        ...normalizedRequest,
        property: resolvedPropertyPath,
      },
      selector: resolvedPropertyPath,
      selectorTemplate: "properties/{propertyId}",
      sourceId: source.id,
      sourceKey: source.sourceKey,
    };
  },
  async execute({ plan, source }) {
    if (plan.kind !== "structured_request") {
      throw new Error(
        `Google Analytics source API operation "${plan.operation}" requires a structured plan`
      );
    }

    const response = await requestGoogleAnalyticsSourceApi({
      credentials: requireGoogleAnalyticsCredentials(source),
      operation: parseGoogleAnalyticsSourceApiOperation(plan.operation),
      request: plan.request,
    });

    return buildGoogleAnalyticsExecutionResponse({
      response,
      source,
      operation: plan.operation,
    });
  },
};

function isGoogleAnalyticsSourceCredentials(
  value: unknown
): value is GoogleAnalyticsCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "ga"
  );
}

export async function requestGoogleAnalyticsSourceApi(input: {
  credentials: GoogleAnalyticsCredentials;
  operation: GoogleAnalyticsSourceApiOperation;
  request: Record<string, unknown>;
}): Promise<GoogleAnalyticsTransportResponse> {
  const resolvedPropertyPath = resolveGoogleAnalyticsPropertyPath({
    credentials: input.credentials,
    request: input.request,
  });
  if (!resolvedPropertyPath) {
    throw new GoogleAnalyticsInvalidRequestError(
      "Property ID is required in request or saved data source credentials"
    );
  }

  const tokenOutcome = await resolveGoogleAnalyticsAccessToken({
    credentials: input.credentials,
  })
    .then((value) => ({ ok: true as const, value }))
    .catch((error: unknown) => ({ error, ok: false as const }));
  if (!tokenOutcome.ok) {
    throw new GoogleAnalyticsAccessTokenError(
      buildGoogleAnalyticsErrorMessage(tokenOutcome.error)
    );
  }

  const requestBody = {
    ...input.request,
  };
  delete requestBody.property;

  const response = await runGoogleAnalyticsDataRequest({
    accessToken: tokenOutcome.value.accessToken,
    method: input.operation,
    propertyPath: resolvedPropertyPath,
    requestBody,
  });
  const contentType = normalizeSourceApiContentType(
    response.headers.get("content-type")
  );
  const bytes = new Uint8Array(await response.arrayBuffer());

  return {
    body: parseGoogleAnalyticsResponseBody({
      bytes,
      contentType,
      status: response.status,
    }),
    contentType,
    headers: Array.from(response.headers.entries()).map(([name, value]) => ({
      name,
      value,
    })),
    resolvedPropertyPath,
    status: response.status,
  };
}

function buildGoogleAnalyticsExamples(sourceKey: string): {
  examples: SourceApiExample[];
  realtimeExamples: SourceApiExample[];
  reportExamples: SourceApiExample[];
} {
  const reportExamples = [
    {
      command: `onequery use --source ${sourceKey} --op run_report --input '{"dateRanges":[{"startDate":"7daysAgo","endDate":"today"}],"dimensions":[{"name":"date"}],"metrics":[{"name":"activeUsers"}],"limit":100}'`,
      description:
        "Run a standard report with the property saved on the connected source.",
      label: "Run a report",
    },
  ] satisfies SourceApiExample[];
  const realtimeExamples = [
    {
      command: `onequery use --source ${sourceKey} --op run_realtime_report -F 'property="properties/123456789"' -F 'dimensions[]={"name":"country"}' -F 'metrics[]={"name":"activeUsers"}'`,
      description:
        "Override the property and run a realtime report with typed field patches.",
      label: "Run a realtime report",
    },
  ] satisfies SourceApiExample[];

  return {
    examples: [...reportExamples, ...realtimeExamples],
    realtimeExamples,
    reportExamples,
  };
}

function requireGoogleAnalyticsSourceApiOperation(input: {
  descriptor: SourceApiDescriptor;
  operationName: string;
}): SourceApiOperation {
  const operation = input.descriptor.operations.find(
    (candidate) => candidate.name === input.operationName.trim()
  );
  if (operation) {
    return operation;
  }

  throw new Error(`Unsupported source API operation: ${input.operationName}`);
}

function parseGoogleAnalyticsSourceApiOperation(
  value: string
): GoogleAnalyticsSourceApiOperation {
  return googleAnalyticsSourceApiOperationSchema.parse(value);
}

function requireGoogleAnalyticsCredentials(
  source: PreparedSourceConnection
): GoogleAnalyticsCredentials {
  if (isGoogleAnalyticsSourceCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("Google Analytics source credentials are invalid");
}

function normalizeGoogleAnalyticsStructuredRequest(input: {
  body: SourceApiRequestBody;
  fieldPatch?: Record<string, unknown>;
}): Record<string, unknown> {
  const baseRequest = parseGoogleAnalyticsRequestBody(input.body);
  return mergeStructuredFieldPatch({
    base: baseRequest,
    patch: input.fieldPatch,
  });
}

function parseGoogleAnalyticsRequestBody(
  body: SourceApiRequestBody
): Record<string, unknown> {
  switch (body.kind) {
    case "none":
      return {};
    case "json":
      if (!isRecord(body.value)) {
        throw new Error(
          "Google Analytics structured requests require a JSON object body"
        );
      }
      return body.value;
    case "text":
    case "binary":
      throw new Error(
        "Google Analytics structured requests do not accept text or binary bodies"
      );
  }
}

function buildGoogleAnalyticsExecutionResponse(input: {
  response: GoogleAnalyticsTransportResponse;
  source: PreparedSourceConnection;
  operation: string;
}): SourceApiExecutionResponse {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: GOOGLE_ANALYTICS_ALLOWED_RESPONSE_HEADERS,
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

function parseGoogleAnalyticsResponseBody(input: {
  bytes: Uint8Array;
  contentType: string;
  status: number;
}): SourceApiResponseBody {
  if (input.status === 204 || input.bytes.length === 0) {
    return { kind: "none" };
  }

  if (
    input.contentType.includes("application/json") ||
    input.contentType.includes("+json")
  ) {
    const text = new TextDecoder().decode(input.bytes);
    if (text.trim().length === 0) {
      return { kind: "none" };
    }

    return {
      kind: "json",
      value: JSON.parse(text) as SourceApiJsonValue,
    };
  }

  if (
    input.contentType.startsWith("text/") ||
    input.contentType.includes("application/xml") ||
    input.contentType.includes("application/x-www-form-urlencoded")
  ) {
    const text = new TextDecoder().decode(input.bytes);
    if (text.trim().length === 0) {
      return { kind: "none" };
    }

    return {
      kind: "text",
      value: text,
    };
  }

  return {
    kind: "binary",
    value: input.bytes,
  };
}

function buildGoogleAnalyticsErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
