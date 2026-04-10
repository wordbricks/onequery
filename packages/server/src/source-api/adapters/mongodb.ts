import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { MongoDBCredentials } from "@onequery/db/server";
import { isMongoCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  findMongoDocuments,
  listMongoCollections,
  listMongoDatabases,
} from "../../services/mongodb/relay";
import {
  SourceApiInvalidRequestError,
  SourceApiUnsupportedOperationError,
} from "../errors";
import {
  filterAllowedResponseHeaders,
  normalizeAllowedHeaders,
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
  SourceApiOperation,
  SourceApiRequestBody,
  SourceApiResponseBody,
} from "../types";

const MONGODB_DESCRIPTOR_VERSION = "mongodb.v1";
const MONGODB_CONTENT_TYPE = "application/json";
const MONGODB_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;

export const mongodbSourceApiOperationSchema = z.enum([
  "list_databases",
  "list_collections",
  "find_documents",
]);

export type MongoDbSourceApiOperation = z.infer<
  typeof mongodbSourceApiOperationSchema
>;

const mongoDbListDatabasesRequestSchema = z.object({}).strict();

const mongoDbListCollectionsRequestSchema = z
  .object({
    database: z.string().min(1).optional(),
  })
  .strict();

const mongoDbFindDocumentsRequestSchema = z
  .object({
    collection: z.string().min(1),
    database: z.string().min(1).optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
    limit: z.number().int().optional(),
    maxTimeMs: z.number().int().optional(),
    projection: z.record(z.string(), z.unknown()).optional(),
    skip: z.number().int().optional(),
    sort: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

type MongoDbListDatabasesRequest = z.infer<
  typeof mongoDbListDatabasesRequestSchema
>;
type MongoDbListCollectionsRequest = z.infer<
  typeof mongoDbListCollectionsRequestSchema
>;
type MongoDbFindDocumentsRequest = z.infer<
  typeof mongoDbFindDocumentsRequestSchema
>;

type MongoDbSourceApiRequest =
  | {
      operation: "list_databases";
      request: MongoDbListDatabasesRequest;
      selector?: undefined;
    }
  | {
      operation: "list_collections";
      request: MongoDbListCollectionsRequest;
      selector?: string;
    }
  | {
      operation: "find_documents";
      request: MongoDbFindDocumentsRequest;
      selector: string;
    };

export type MongoDbTransportResponse = {
  body: SourceApiResponseBody;
  contentType: string;
  headers: SourceApiHeader[];
  status: number;
};

type MongoDbSourceApiDependencies = {
  findDocuments: typeof findMongoDocuments;
  listCollections: typeof listMongoCollections;
  listDatabases: typeof listMongoDatabases;
};

const DEFAULT_MONGODB_SOURCE_API_DEPENDENCIES: MongoDbSourceApiDependencies = {
  findDocuments: findMongoDocuments,
  listCollections: listMongoCollections,
  listDatabases: listMongoDatabases,
};

export class MongoDbInvalidRequestError extends SourceApiInvalidRequestError {}

export function createMongoDbSourceApiAdapter(
  dependencies: MongoDbSourceApiDependencies = DEFAULT_MONGODB_SOURCE_API_DEPENDENCIES
): SourceApiAdapter {
  return {
    provider: "mongodb",
    async describe({ source }) {
      const {
        examples,
        findExamples,
        listCollectionsExamples,
        listDatabasesExamples,
      } = buildMongoDbExamples(source.sourceKey);

      return {
        descriptorVersion: MONGODB_DESCRIPTOR_VERSION,
        examples,
        notes: [
          "If the connected source restricts databases, MongoDB results stay inside that allowlist.",
        ],
        operations: [
          createStructuredRequestOperation({
            allowedResponseHeaders: MONGODB_ALLOWED_RESPONSE_HEADERS,
            description:
              "List MongoDB databases visible to the connected source.",
            examples: listDatabasesExamples,
            fieldPolicy: {
              acceptsInput: false,
              allowsRawFields: false,
              allowsTypedFields: false,
              inputMode: "none",
              mergePatches: false,
              supportsArrayPaths: false,
              supportsNestedPaths: false,
            },
            name: "list_databases",
            notes: [
              "When the source configuration restricts databases, only those databases are returned.",
            ],
            summary: "List available MongoDB databases.",
          }),
          createStructuredRequestOperation({
            allowedResponseHeaders: MONGODB_ALLOWED_RESPONSE_HEADERS,
            description:
              "List collections in one MongoDB database for the connected source.",
            examples: listCollectionsExamples,
            fieldPolicy: {
              supportsArrayPaths: false,
              supportsNestedPaths: false,
            },
            name: "list_collections",
            notes: [
              "Pass the database as the selector or in `request.database`.",
            ],
            selectorKind: "identifier",
            selectorLabel: "DATABASE",
            summary: "List collections for one database.",
          }),
          createStructuredRequestOperation({
            allowedResponseHeaders: MONGODB_ALLOWED_RESPONSE_HEADERS,
            description:
              "Find documents in one MongoDB collection using the connected source.",
            examples: findExamples,
            name: "find_documents",
            notes: [
              "Pass the collection as the selector or in `request.collection`.",
              "Use `filter`, `projection`, `sort`, `limit`, `skip`, and `maxTimeMs` to shape the query.",
            ],
            selectorKind: "identifier",
            selectorLabel: "COLLECTION",
            summary: "Find documents in one collection.",
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
      const operation = requireMongoDbSourceApiOperation({
        descriptor,
        operationName: request.operation,
      });

      if (request.methodOverride?.trim()) {
        throw new MongoDbInvalidRequestError(
          `MongoDB operation "${operation.name}" does not support method overrides`
        );
      }

      const headers = normalizeAllowedHeaders({
        allowedNames: operation.headerPolicy.allowedRequestHeaders,
        headers: request.headers,
      });
      const normalizedRequest = normalizeMongoDbStructuredRequest({
        body: request.body,
        fieldPatch: request.fieldPatch,
        operation: parseMongoDbSourceApiOperation(operation.name),
        selector: request.selector,
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
        request: normalizedRequest.request as JsonObject,
        selector: normalizedRequest.selector,
        selectorTemplate: readMongoDbSelectorTemplate(normalizedRequest),
        sourceId: source.id,
        sourceKey: source.sourceKey,
      };
    },
    async execute({ prepared, source }) {
      if (prepared.kind !== "structured_request") {
        throw new Error(
          `MongoDB source API operation "${prepared.operation}" requires a structured plan`
        );
      }

      const response = await requestMongoDbSourceApi({
        credentials: requireMongoDbCredentials(source),
        dependencies,
        operation: parseMongoDbSourceApiOperation(prepared.operation),
        request: prepared.request,
      });

      return buildMongoDbExecutionResponse({
        operation: prepared.operation,
        response,
        selector: prepared.selector,
        source,
      });
    },
  };
}

export const mongodbSourceApiAdapter = createMongoDbSourceApiAdapter();

export async function requestMongoDbSourceApi(input: {
  credentials: MongoDBCredentials;
  dependencies?: MongoDbSourceApiDependencies;
  operation: MongoDbSourceApiOperation;
  request:
    | MongoDbListDatabasesRequest
    | MongoDbListCollectionsRequest
    | MongoDbFindDocumentsRequest;
}): Promise<MongoDbTransportResponse> {
  const dependencies =
    input.dependencies ?? DEFAULT_MONGODB_SOURCE_API_DEPENDENCIES;
  const normalizedRequest = parseMongoDbSourceApiRequest({
    operation: input.operation,
    request: input.request,
  });

  switch (normalizedRequest.operation) {
    case "list_databases":
      return buildMongoDbTransportResponse(
        await dependencies.listDatabases({
          credentials: input.credentials,
        })
      );
    case "list_collections":
      return buildMongoDbTransportResponse(
        await dependencies.listCollections({
          credentials: input.credentials,
          request: normalizedRequest.request,
        })
      );
    case "find_documents":
      return buildMongoDbTransportResponse(
        await dependencies.findDocuments({
          credentials: input.credentials,
          request: normalizedRequest.request,
        })
      );
  }
}

function buildMongoDbExamples(sourceKey: string): {
  examples: SourceApiExample[];
  findExamples: SourceApiExample[];
  listDatabasesExamples: SourceApiExample[];
  listCollectionsExamples: SourceApiExample[];
} {
  const listDatabasesExamples = [
    {
      command: `onequery api --source ${sourceKey} --op list_databases`,
      description: "List databases visible to the connected MongoDB source.",
      label: "List databases",
    },
  ] satisfies SourceApiExample[];
  const listCollectionsExamples = [
    {
      command: `onequery api --source ${sourceKey} --op list_collections analytics`,
      description: "List collections in the `analytics` database.",
      label: "List collections",
    },
  ] satisfies SourceApiExample[];
  const findExamples = [
    {
      command: `onequery api --source ${sourceKey} --op find_documents events -F 'filter={"status":"active"}' -F limit=25`,
      description:
        "Fetch active documents from the `events` collection with a typed filter patch.",
      label: "Find documents",
    },
  ] satisfies SourceApiExample[];

  return {
    examples: [
      ...listDatabasesExamples,
      ...listCollectionsExamples,
      ...findExamples,
    ],
    findExamples,
    listDatabasesExamples,
    listCollectionsExamples,
  };
}

function requireMongoDbSourceApiOperation(input: {
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

function parseMongoDbSourceApiOperation(
  value: string
): MongoDbSourceApiOperation {
  return mongodbSourceApiOperationSchema.parse(value);
}

function requireMongoDbCredentials(
  source: PreparedSourceConnection
): MongoDBCredentials {
  if (isMongoCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("MongoDB source credentials are invalid");
}

function normalizeMongoDbStructuredRequest(input: {
  body: SourceApiRequestBody;
  fieldPatch?: JsonObject;
  operation: MongoDbSourceApiOperation;
  selector?: string;
}): MongoDbSourceApiRequest {
  const baseRequest = parseMongoDbRequestBody(input.body);
  return parseMongoDbSourceApiRequest({
    operation: input.operation,
    request: mergeStructuredFieldPatch({
      base: baseRequest,
      patch: input.fieldPatch,
    }),
    selector: input.selector,
  });
}

function parseMongoDbRequestBody(body: SourceApiRequestBody): JsonObject {
  switch (body.kind) {
    case "none":
      return {};
    case "json":
      if (!isRecord(body.value)) {
        throw new MongoDbInvalidRequestError(
          "MongoDB operations require a JSON object request body"
        );
      }
      return body.value;
    case "text":
    case "binary":
      throw new MongoDbInvalidRequestError(
        "MongoDB operations require a JSON object request body"
      );
  }
}

function parseMongoDbSourceApiRequest(input: {
  operation: MongoDbSourceApiOperation;
  request: unknown;
  selector?: string;
}): MongoDbSourceApiRequest {
  const selector = normalizeSelector(input.selector);

  switch (input.operation) {
    case "list_databases": {
      if (selector) {
        throw new MongoDbInvalidRequestError(
          'MongoDB operation "list_databases" does not accept a selector'
        );
      }

      return {
        operation: input.operation,
        request: parseMongoDbRequestSchema({
          errorMessage: "Invalid MongoDB list_databases request payload",
          request: input.request,
          schema: mongoDbListDatabasesRequestSchema,
        }),
      };
    }
    case "list_collections": {
      const request = parseMongoDbRequestSchema({
        errorMessage: "Invalid MongoDB list_collections request payload",
        request: applyMongoDbSelectorField({
          field: "database",
          request: input.request,
          selector,
        }),
        schema: mongoDbListCollectionsRequestSchema,
      });

      return {
        operation: input.operation,
        request,
        selector: request.database,
      };
    }
    case "find_documents": {
      const request = parseMongoDbRequestSchema({
        errorMessage: "Invalid MongoDB find_documents request payload",
        request: applyMongoDbSelectorField({
          field: "collection",
          request: input.request,
          selector,
        }),
        schema: mongoDbFindDocumentsRequestSchema,
      });

      return {
        operation: input.operation,
        request,
        selector: request.collection,
      };
    }
  }
}

function readMongoDbSelectorTemplate(
  request: MongoDbSourceApiRequest
): string | undefined {
  switch (request.operation) {
    case "list_databases":
      return "databases";
    case "list_collections":
      return "databases/{database}";
    case "find_documents":
      return "collections/{collection}";
  }
}

function applyMongoDbSelectorField(input: {
  field: "collection" | "database";
  request: unknown;
  selector?: string;
}): unknown {
  if (!input.selector || !isRecord(input.request)) {
    return input.request;
  }

  const current = input.request[input.field];
  if (current === undefined) {
    return {
      ...input.request,
      [input.field]: input.selector,
    };
  }
  if (
    typeof current === "string" &&
    current.trim().length > 0 &&
    current.trim() !== input.selector
  ) {
    throw new MongoDbInvalidRequestError(
      `MongoDB selector conflicts with request.${input.field}`
    );
  }

  return input.request;
}

function parseMongoDbRequestSchema<TSchema extends z.ZodType>(input: {
  errorMessage: string;
  request: unknown;
  schema: TSchema;
}): z.infer<TSchema> {
  const parsed = input.schema.safeParse(input.request);
  if (parsed.success) {
    return parsed.data;
  }

  throw new MongoDbInvalidRequestError(input.errorMessage);
}

function buildMongoDbTransportResponse(
  value: unknown
): MongoDbTransportResponse {
  return {
    body: {
      kind: "json",
      value: toSourceApiJsonValue(value),
    },
    contentType: MONGODB_CONTENT_TYPE,
    headers: [
      {
        name: "content-type",
        value: MONGODB_CONTENT_TYPE,
      },
    ],
    status: 200,
  };
}

function buildMongoDbExecutionResponse(input: {
  operation: string;
  response: MongoDbTransportResponse;
  selector?: string;
  source: PreparedSourceConnection;
}): SourceApiExecutionResponse {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: MONGODB_ALLOWED_RESPONSE_HEADERS,
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

function toSourceApiJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function normalizeSelector(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
