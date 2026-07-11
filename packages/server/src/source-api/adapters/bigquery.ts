import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { BigQueryCredentials } from "@onequery/db/server";
import { z } from "zod";

import { resolveBigQueryAccessToken } from "../../services/data-source-query/bigquery-client";
import { requestBigQueryJson } from "../../services/data-source-query/bigquery-client/transport";
import {
  SourceApiInvalidRequestError,
  SourceApiUnsupportedOperationError,
} from "../errors";
import { normalizeAllowedHeaders } from "../helpers/http-rest";
import { mergeStructuredFieldPatch } from "../helpers/structured";
import type {
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResult,
  SourceApiOperation,
  SourceApiRequestBody,
} from "../types";

const BIGQUERY_DESCRIPTOR_VERSION = "bigquery.v1";
const BIGQUERY_DATASETS_LIST_OPERATION = "datasets_list";
const BIGQUERY_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;

const BigQueryDatasetsListRequestSchema = z
  .object({
    all: z.boolean().optional(),
    filter: z.string().min(1).optional(),
    maxResults: z.number().int().min(1).max(1000).optional(),
    pageToken: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(1).optional(),
  })
  .strict();

type BigQueryDatasetsListRequest = z.infer<
  typeof BigQueryDatasetsListRequestSchema
>;

class BigQuerySourceApiInvalidRequestError extends SourceApiInvalidRequestError {}

export const bigQuerySourceApiAdapter: SourceApiAdapter = {
  provider: "bigquery",
  async describe({ source }) {
    const examples = buildBigQueryExamples(source.sourceKey);

    return {
      descriptorVersion: BIGQUERY_DESCRIPTOR_VERSION,
      examples,
      notes: [
        "BigQuery source API operations use the credential saved on the connected source.",
      ],
      operations: [createBigQueryDatasetsListOperation(examples)],
      source: {
        displayName: source.displayName,
        sourceKey: source.sourceKey,
        provider: source.provider,
      },
    };
  },
  async normalize({ descriptor, request, source }) {
    const operation = requireBigQuerySourceApiOperation({
      descriptor,
      operationName: request.operation,
    });

    if (request.selector?.trim()) {
      throw new BigQuerySourceApiInvalidRequestError(
        `BigQuery operation "${operation.name}" does not accept a selector`
      );
    }
    if (request.methodOverride?.trim()) {
      throw new BigQuerySourceApiInvalidRequestError(
        `BigQuery operation "${operation.name}" does not support method overrides`
      );
    }

    const headers = normalizeAllowedHeaders({
      allowedNames: operation.headerPolicy.allowedRequestHeaders,
      headers: request.headers,
    });
    const normalizedRequest = normalizeBigQueryDatasetsListRequest({
      body: request.body,
      fieldPatch: request.fieldPatch,
    });

    return {
      body: request.body,
      descriptorVersion: descriptor.descriptorVersion,
      headers,
      kind: "structured_request",
      method: "GET",
      metadata: {
        apiPath: `/projects/${requireBigQueryCredentials(source).projectId}/datasets`,
      },
      operation: operation.name,
      paginationPolicy: operation.paginationPolicy,
      provider: source.provider,
      request: normalizedRequest,
      selectorTemplate: "projects/{projectId}/datasets",
      sourceId: source.id,
      sourceKey: source.sourceKey,
    };
  },
  async execute({ prepared, source }) {
    if (prepared.kind !== "structured_request") {
      throw new Error(
        `BigQuery source API operation "${prepared.operation}" requires a structured plan`
      );
    }

    const response = await requestBigQueryDatasetsList({
      credentials: requireBigQueryCredentials(source),
      request: parseBigQueryDatasetsListRequest(prepared.request),
    });

    return {
      body: {
        kind: "json",
        value: toJsonValue(response),
      },
      contentType: "application/json",
      headers: [{ name: "content-type", value: "application/json" }],
      operation: prepared.operation,
      source: {
        displayName: source.displayName,
        sourceKey: source.sourceKey,
        provider: source.provider,
      },
      status: 200,
    } satisfies SourceApiExecutionResult;
  },
};

function createBigQueryDatasetsListOperation(
  examples: readonly SourceApiExample[]
): SourceApiOperation {
  return {
    description:
      "Call the BigQuery datasets.list REST API for the connected project.",
    examples,
    fieldPolicy: {
      acceptsInput: true,
      allowsRawFields: true,
      allowsTypedFields: true,
      inputMode: "request_object",
      mergePatches: true,
      supportsArrayPaths: false,
      supportsNestedPaths: false,
    },
    headerPolicy: {
      allowedRequestHeaders: [],
      allowedResponseHeaders: BIGQUERY_ALLOWED_RESPONSE_HEADERS,
    },
    kind: "structured_request",
    methodPolicy: {
      allowedMethods: ["GET"],
      defaultMethod: "GET",
    },
    name: BIGQUERY_DATASETS_LIST_OPERATION,
    notes: [
      "`all`, `filter`, `maxResults`, and `pageToken` map to BigQuery datasets.list query parameters.",
    ],
    paginationPolicy: "none",
    selectorKind: "none",
    summary: "List BigQuery datasets.",
  };
}

function buildBigQueryExamples(sourceKey: string): SourceApiExample[] {
  return [
    {
      command: `onequery api --source ${sourceKey} --op datasets_list --input '{"all":true,"maxResults":1000}'`,
      description:
        "List datasets in the BigQuery project saved on the connected source.",
      label: "List datasets",
    },
  ];
}

function requireBigQuerySourceApiOperation(input: {
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

function isBigQueryCredentials(value: unknown): value is BigQueryCredentials {
  return isRecord(value) && value.type === "bigquery";
}

function requireBigQueryCredentials(
  source: PreparedSourceConnection
): BigQueryCredentials {
  if (isBigQueryCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("BigQuery source credentials are invalid");
}

function normalizeBigQueryDatasetsListRequest(input: {
  body: SourceApiRequestBody;
  fieldPatch?: JsonObject;
}): JsonObject {
  const baseRequest = parseBigQueryRequestBody(input.body);
  const merged = mergeStructuredFieldPatch({
    base: baseRequest,
    patch: input.fieldPatch,
  });
  return parseBigQueryDatasetsListRequest(merged);
}

function parseBigQueryRequestBody(body: SourceApiRequestBody): JsonObject {
  switch (body.kind) {
    case "none":
      return {};
    case "json":
      if (!isRecord(body.value)) {
        throw new BigQuerySourceApiInvalidRequestError(
          "BigQuery structured requests require a JSON object body"
        );
      }
      return body.value;
    case "text":
    case "binary":
      throw new BigQuerySourceApiInvalidRequestError(
        "BigQuery structured requests do not accept text or binary bodies"
      );
  }
}

function parseBigQueryDatasetsListRequest(
  value: JsonObject
): BigQueryDatasetsListRequest {
  const result = BigQueryDatasetsListRequestSchema.safeParse(value);
  if (!result.success) {
    throw new BigQuerySourceApiInvalidRequestError(
      "BigQuery datasets.list request had an unexpected shape"
    );
  }

  return result.data;
}

async function requestBigQueryDatasetsList(input: {
  credentials: BigQueryCredentials;
  request: BigQueryDatasetsListRequest;
}): Promise<unknown> {
  return requestBigQueryJson({
    accessTokenPromise: resolveBigQueryAccessToken(input.credentials),
    path: "/datasets",
    projectId: input.credentials.projectId,
    query: buildBigQueryDatasetsListQuery(input.request),
    timeoutMs: input.request.timeoutMs,
  });
}

function buildBigQueryDatasetsListQuery(
  request: BigQueryDatasetsListRequest
): Record<string, string> {
  return {
    ...(typeof request.all === "boolean" ? { all: String(request.all) } : {}),
    ...(request.filter ? { filter: request.filter } : {}),
    ...(request.maxResults ? { maxResults: String(request.maxResults) } : {}),
    ...(request.pageToken ? { pageToken: request.pageToken } : {}),
  };
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry === undefined ||
      typeof entry === "function" ||
      typeof entry === "symbol"
        ? null
        : toJsonValue(entry)
    );
  }

  if (isRecord(value)) {
    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        entry === undefined ||
        typeof entry === "function" ||
        typeof entry === "symbol"
      ) {
        continue;
      }
      result[key] = toJsonValue(entry);
    }
    return result;
  }

  throw new Error("BigQuery API response must be JSON-serializable");
}
