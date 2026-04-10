import { fromJson, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { timestampFromDate, ValueSchema } from "@bufbuild/protobuf/wkt";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";
import type {
  NormalizedExecutionPlan,
  SourceApiDescriptor,
  SourceApiBodyKind,
  SourceApiExample,
  SourceApiExecuteRequest,
  SourceApiExecutionResponse,
  SourceApiFieldPolicy,
  SourceApiHeader,
  SourceApiJsonValue,
  SourceApiOperation,
  SourceApiRequestBody,
  SourceApiResponseBody,
  SourceApiSource,
} from "@onequery/server/source-api";

import type { CliAction } from "../../authorization";
import type { CliSessionIdentity } from "../../domain/workflows";
import { throwCliConnectError } from "../error";
import { CliAuthMode } from "../gen/onequery/cli/v1/auth_pb";
import { CliContentFormat } from "../gen/onequery/cli/v1/common_pb";
import { CliOrgCapability } from "../gen/onequery/cli/v1/org_pb";
import { CliQueryLogicalType } from "../gen/onequery/cli/v1/query_pb";
import type {
  CliSourceApiInvocation,
  ExecuteSourceApiRequest,
  NormalizeSourceApiRequest,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  CliSourceApiBodyKind,
  CliSourceApiInputMode,
  CliSourceApiOperationKind,
  CliSourceApiPaginationPolicy,
  CliSourceApiSelectorKind,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  CliSourceProvider,
  CliSourceStatus,
} from "../gen/onequery/cli/v1/source_pb";

export function timestampFromIsoString(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }

  return timestampFromDate(parsed);
}

export function toCliAuthMode(value: CliSessionIdentity["authMode"]) {
  switch (value) {
    case "browser_session":
      return CliAuthMode.BROWSER_SESSION;
    case "bearer_token":
      return CliAuthMode.BEARER_TOKEN;
  }
}

export function toCliContentFormat(value: "markdown") {
  switch (value) {
    case "markdown":
      return CliContentFormat.MARKDOWN;
  }
}

export function toCliOrgCapability(value: CliAction) {
  switch (value) {
    case "org.list":
      return CliOrgCapability.ORG_LIST;
    case "org.read":
      return CliOrgCapability.ORG_READ;
    case "source.connect":
      return CliOrgCapability.SOURCE_CONNECT;
    case "source.list":
      return CliOrgCapability.SOURCE_LIST;
    case "source.read":
      return CliOrgCapability.SOURCE_READ;
    case "source_api.describe":
      return CliOrgCapability.SOURCE_API_DESCRIBE;
    case "source_api.execute":
      return CliOrgCapability.SOURCE_API_EXECUTE;
    case "query.execute":
      return CliOrgCapability.QUERY_EXECUTE;
  }
}

export function toCliSourceProvider(value: ProviderType) {
  switch (value) {
    case "postgres":
      return CliSourceProvider.POSTGRES;
    case "supabase":
      return CliSourceProvider.SUPABASE;
    case "mysql":
      return CliSourceProvider.MYSQL;
    case "mongodb":
      return CliSourceProvider.MONGODB;
    case "bigquery":
      return CliSourceProvider.BIGQUERY;
    case "laminar":
      return CliSourceProvider.LAMINAR;
    case "aws_athena_connector":
      return CliSourceProvider.AWS_ATHENA_CONNECTOR;
    case "ga":
      return CliSourceProvider.GA;
    case "amplitude":
      return CliSourceProvider.AMPLITUDE;
    case "mixpanel":
      return CliSourceProvider.MIXPANEL;
    case "posthog":
      return CliSourceProvider.POSTHOG;
    case "sentry":
      return CliSourceProvider.SENTRY;
    case "github":
      return CliSourceProvider.GITHUB;
    case "linear":
      return CliSourceProvider.LINEAR;
  }
}

export function fromCliSourceProvider(value: CliSourceProvider): ProviderType {
  switch (value) {
    case CliSourceProvider.POSTGRES:
      return "postgres";
    case CliSourceProvider.SUPABASE:
      return "supabase";
    case CliSourceProvider.MYSQL:
      return "mysql";
    case CliSourceProvider.MONGODB:
      return "mongodb";
    case CliSourceProvider.BIGQUERY:
      return "bigquery";
    case CliSourceProvider.LAMINAR:
      return "laminar";
    case CliSourceProvider.AWS_ATHENA_CONNECTOR:
      return "aws_athena_connector";
    case CliSourceProvider.GA:
      return "ga";
    case CliSourceProvider.AMPLITUDE:
      return "amplitude";
    case CliSourceProvider.MIXPANEL:
      return "mixpanel";
    case CliSourceProvider.POSTHOG:
      return "posthog";
    case CliSourceProvider.SENTRY:
      return "sentry";
    case CliSourceProvider.GITHUB:
      return "github";
    case CliSourceProvider.LINEAR:
      return "linear";
    default:
      throwCliConnectError({
        detail: "unsupported source provider",
        key: "INVALID_REQUEST",
      });
  }
}

export function toCliSourceStatus(value: DataSourceStatus) {
  switch (value) {
    case "active":
      return CliSourceStatus.ACTIVE;
    case "error":
      return CliSourceStatus.ERROR;
    case "disconnected":
      return CliSourceStatus.DISCONNECTED;
  }
}

export function toCliQueryLogicalType(value: string) {
  switch (value) {
    case "string":
      return CliQueryLogicalType.STRING;
    case "number":
      return CliQueryLogicalType.NUMBER;
    case "boolean":
      return CliQueryLogicalType.BOOLEAN;
    case "bigint":
      return CliQueryLogicalType.BIGINT;
    case "datetime":
      return CliQueryLogicalType.DATETIME;
    case "array":
      return CliQueryLogicalType.ARRAY;
    case "json":
      return CliQueryLogicalType.JSON;
    default:
      return undefined;
  }
}

export function fromCliExecuteSourceApiRequest(
  request: ExecuteSourceApiRequest
): SourceApiExecuteRequest {
  return fromCliSourceApiInvocation(
    requireCliSourceApiInvocation(request.invocation)
  );
}

export function fromCliNormalizeSourceApiRequest(
  request: NormalizeSourceApiRequest
): SourceApiExecuteRequest {
  return fromCliSourceApiInvocation(
    requireCliSourceApiInvocation(request.invocation)
  );
}

export function toCliNormalizeSourceApiResponse(
  value: NormalizedExecutionPlan
) {
  return {
    plan: {
      bodyKind: toCliSourceApiBodyKind(value.bodyKind),
      bodyPaths: [...(value.bodyPaths ?? [])],
      descriptorVersion: value.descriptorVersion,
      headerNames: [...value.headerNames],
      host: value.host,
      kind: toCliSourceApiOperationKind(value.kind),
      method: value.method,
      operation: value.operation,
      provider: value.provider,
      requestFingerprint: value.requestFingerprint,
      selector: value.selector,
      selectorTemplate: value.selectorTemplate,
      sourceId: value.sourceId,
      sourceKey: value.sourceKey,
    },
  };
}

export function requireCliSourceApiInvocation(
  invocation: CliSourceApiInvocation | undefined
): CliSourceApiInvocation {
  if (invocation) {
    return invocation;
  }

  throwCliConnectError({
    detail: "source API request missing invocation payload",
    key: "INVALID_REQUEST",
  });
}

function fromCliSourceApiInvocation(
  request: CliSourceApiInvocation
): SourceApiExecuteRequest {
  return {
    body: fromCliSourceApiRequestBody(request.body),
    descriptorVersion: request.descriptorVersion,
    fieldPatch: request.fieldPatch,
    headers: request.headers.map(fromCliSourceApiHeader),
    methodOverride: request.methodOverride,
    operation: request.operation,
    pageToken: request.pageToken,
    selector: request.selector,
  };
}

export function toCliDescribeSourceApiResponse(value: SourceApiDescriptor) {
  return {
    defaultPathOperation: value.defaultPathOperation,
    descriptorVersion: value.descriptorVersion,
    examples: value.examples.map(toCliSourceApiExample),
    notes: [...value.notes],
    operations: value.operations.map(toCliSourceApiOperation),
    source: toCliSourceApiSource(value.source),
  };
}

export function toCliExecuteSourceApiResponse(
  value: SourceApiExecutionResponse
) {
  return {
    body: toCliSourceApiResponseBody(value.body),
    contentType: value.contentType,
    headers: value.headers.map(toCliSourceApiHeader),
    nextPageToken: value.nextPageToken,
    operation: value.operation,
    requestId: value.requestId,
    selector: value.selector,
    source: toCliSourceApiSource(value.source),
    status: value.status,
  };
}

function fromCliSourceApiHeader(value: SourceApiHeader) {
  return {
    name: value.name,
    value: value.value,
  };
}

function fromCliSourceApiRequestBody(
  body: CliSourceApiInvocation["body"]
): SourceApiRequestBody {
  switch (body.case) {
    case "jsonBody":
      return {
        kind: "json",
        value: toSourceApiJsonValue(toJson(ValueSchema, body.value)),
      };
    case "textBody":
      return {
        kind: "text",
        value: body.value,
      };
    case "binaryBody":
      return {
        kind: "binary",
        value: body.value,
      };
    case undefined:
      return {
        kind: "none",
      };
  }
}

function toSourceApiJsonValue(value: JsonValue): SourceApiJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toSourceApiJsonValue);
  }

  const object: Record<string, SourceApiJsonValue> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    object[key] = toSourceApiJsonValue(nestedValue);
  }

  return object;
}

function toCliSourceApiInputMode(value: SourceApiFieldPolicy["inputMode"]) {
  switch (value) {
    case "none":
      return CliSourceApiInputMode.NONE;
    case "request_object":
      return CliSourceApiInputMode.REQUEST_OBJECT;
    case "request_body":
      return CliSourceApiInputMode.REQUEST_BODY;
  }
}

function toCliSourceApiExample(value: SourceApiExample) {
  return {
    command: value.command,
    description: value.description,
    label: value.label,
  };
}

function toCliSourceApiFieldPolicy(value: SourceApiFieldPolicy) {
  return {
    acceptsInput: value.acceptsInput,
    inputMode: toCliSourceApiInputMode(value.inputMode),
    mergePatches: value.mergePatches,
    supportsArrayPaths: value.supportsArrayPaths,
    supportsNestedPaths: value.supportsNestedPaths,
    supportsRawFields: value.allowsRawFields,
    supportsTypedFields: value.allowsTypedFields,
  };
}

function toCliSourceApiHeader(value: SourceApiHeader) {
  return {
    name: value.name,
    value: value.value,
  };
}

function toCliSourceApiOperation(value: SourceApiOperation) {
  return {
    description: value.description,
    examples: value.examples.map(toCliSourceApiExample),
    fieldPolicy: toCliSourceApiFieldPolicy(value.fieldPolicy),
    headerPolicy: {
      allowedNames: [...value.headerPolicy.allowedRequestHeaders],
    },
    kind: toCliSourceApiOperationKind(value.kind),
    methodPolicy: {
      allowedMethods: [...value.methodPolicy.allowedMethods],
      defaultMethod: value.methodPolicy.defaultMethod,
    },
    name: value.name,
    notes: [...value.notes],
    paginationPolicy: toCliSourceApiPaginationPolicy(value.paginationPolicy),
    selectorKind: toCliSourceApiSelectorKind(value.selectorKind),
    selectorLabel: value.selectorLabel,
    summary: value.summary,
  };
}

function toCliSourceApiOperationKind(
  value: SourceApiOperation["kind"]
): CliSourceApiOperationKind {
  switch (value) {
    case "http_request":
      return CliSourceApiOperationKind.HTTP_REQUEST;
    case "structured_request":
      return CliSourceApiOperationKind.STRUCTURED_REQUEST;
  }
}

function toCliSourceApiBodyKind(
  value: SourceApiBodyKind
): CliSourceApiBodyKind {
  switch (value) {
    case "none":
      return CliSourceApiBodyKind.NONE;
    case "json":
      return CliSourceApiBodyKind.JSON;
    case "text":
      return CliSourceApiBodyKind.TEXT;
    case "binary":
      return CliSourceApiBodyKind.BINARY;
  }
}

function toCliSourceApiPaginationPolicy(
  value: SourceApiOperation["paginationPolicy"]
): CliSourceApiPaginationPolicy {
  switch (value) {
    case "none":
      return CliSourceApiPaginationPolicy.NONE;
    case "opaque_token":
      return CliSourceApiPaginationPolicy.OPAQUE_TOKEN;
  }
}

function toCliSourceApiResponseBody(value: SourceApiResponseBody) {
  switch (value.kind) {
    case "json":
      return {
        case: "json" as const,
        // Connect expects an actual google.protobuf.Value message here.
        value: fromJson(ValueSchema, value.value as JsonValue),
      };
    case "text":
      return {
        case: "text" as const,
        value: value.value,
      };
    case "binary":
      return {
        case: "binary" as const,
        value: value.value,
      };
    case "none":
      return {
        case: undefined,
        value: undefined,
      };
  }
}

function toCliSourceApiSelectorKind(
  value: SourceApiOperation["selectorKind"]
): CliSourceApiSelectorKind {
  switch (value) {
    case "none":
      return CliSourceApiSelectorKind.NONE;
    case "path":
      return CliSourceApiSelectorKind.PATH;
    case "identifier":
      return CliSourceApiSelectorKind.IDENTIFIER;
  }
}

function toCliSourceApiSource(value: SourceApiSource) {
  return {
    displayName: value.displayName ?? undefined,
    key: value.key,
    provider: value.provider,
  };
}
