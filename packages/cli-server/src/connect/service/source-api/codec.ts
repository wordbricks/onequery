import { fromJson, isFieldSet, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import type {
  SourceApiBodyFormat,
  SourceApiDescriptor,
  SourceApiExecutionResult,
  SourceApiFieldPolicy,
  SourceApiHeader,
  SourceApiOperation,
  SourceApiRequestBody,
  SourceApiResponseBody,
  SourceApiSource,
  SourceApiDraft,
  SourceApiPreview,
} from "@onequery/server/source-api";
import { Result } from "better-result";

import {
  SourceApiBodyKind,
  SourceApiFieldEncoding,
  SourceApiInputMode,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  SourceApiPatchMode,
  SourceApiPathCapability,
  SourceApiDraftSchema,
  SourceApiSelectorKind,
} from "../../gen/onequery/cli/v1/source_api_pb";
import type { SourceApiDraft as CliSourceApiDraft } from "../../gen/onequery/cli/v1/source_api_pb";
import { cliServiceErr } from "../result";
import type { CliServiceResult } from "../result";
import { toCliSourceProvider } from "../source-provider";
import type {
  CliExecuteSourceApiRequest,
  CliPreviewSourceApiRequest,
  CliResumeSourceApiRequest,
  CliSourceApiExecutionResultInit,
  CliSourceApiPreviewInit,
  DescribeSourceApiResponseInit,
  ExecuteSourceApiResponseInit,
  PreviewSourceApiResponseInit,
  ResumeSourceApiResponseInit,
  SourceApiResumeCommand,
  SourceApiStartCommand,
  SourceApiTarget,
} from "./types";

export function resolveSourceApiStartCommand(
  input: CliPreviewSourceApiRequest | CliExecuteSourceApiRequest
): CliServiceResult<SourceApiStartCommand> {
  if (!input.target) {
    return cliServiceErr({
      detail: "source API request missing target payload",
      key: "SOURCE_API_REQUEST_INVALID",
    });
  }

  if (!input.draft) {
    return cliServiceErr({
      detail: "source API request missing draft payload",
      key: "SOURCE_API_REQUEST_INVALID",
    });
  }

  return Result.ok({
    draft: input.draft,
    target: buildSourceApiTarget(input.target),
  });
}

export function resolveSourceApiResumeCommand(
  input: CliResumeSourceApiRequest
): CliServiceResult<SourceApiResumeCommand> {
  if (!input.target) {
    return cliServiceErr({
      detail: "source API request missing target payload",
      key: "SOURCE_API_REQUEST_INVALID",
    });
  }

  return Result.ok({
    continuationToken: input.continuationToken,
    target: buildSourceApiTarget(input.target),
  });
}

function buildSourceApiTarget(input: {
  orgSlug: string;
  sourceKey: string;
}): SourceApiTarget {
  return {
    orgSlug: input.orgSlug,
    sourceKey: input.sourceKey,
  };
}

export function buildSourceApiDraft(
  request: CliSourceApiDraft
): SourceApiDraft {
  const payload = buildSourceApiDraftPayload(request.body);

  return {
    body: payload.body,
    descriptorVersion: request.descriptorVersion,
    ...(payload.fieldPatch ? { fieldPatch: payload.fieldPatch } : {}),
    headers: request.headers.map(copySourceApiHeader),
    ...(isFieldSet(request, SourceApiDraftSchema.field.methodOverride)
      ? { methodOverride: request.methodOverride }
      : {}),
    operation: request.operationName,
    ...(isFieldSet(request, SourceApiDraftSchema.field.selector)
      ? { selector: request.selector }
      : {}),
  };
}

export function buildCliDescribeSourceApiResponse(
  value: SourceApiDescriptor
): DescribeSourceApiResponseInit {
  return {
    descriptorVersion: value.descriptorVersion,
    examples: value.examples.map(buildCliSourceApiExample),
    notes: [...value.notes],
    operations: value.operations.map(buildCliSourceApiOperation),
    source: buildCliSourceApiSource(value.source),
    ...(value.defaultPathOperation
      ? { defaultPathOperationName: value.defaultPathOperation }
      : {}),
  };
}

type CliExecuteSourceApiResponseInput =
  | {
      kind: "completed";
      preview: SourceApiPreview;
      result: SourceApiExecutionResult;
    }
  | {
      continuationToken: string;
      kind: "continued";
      preview: SourceApiPreview;
      result: SourceApiExecutionResult;
    };

export function buildCliPreviewSourceApiResponse(input: {
  preview: SourceApiPreview;
}): PreviewSourceApiResponseInit {
  return {
    preview: buildCliSourceApiPreview(input.preview),
  };
}

export function buildCliExecuteSourceApiResponse(
  input: CliExecuteSourceApiResponseInput
): ExecuteSourceApiResponseInit {
  const preview = buildCliSourceApiPreview(input.preview);

  switch (input.kind) {
    case "completed":
      return {
        outcome: {
          case: "completed",
          value: {
            preview,
            result: buildCliSourceApiExecutionResult(input.result),
          },
        },
      };
    case "continued":
      return {
        outcome: {
          case: "continued",
          value: {
            continuationToken: input.continuationToken,
            preview,
            result: buildCliSourceApiExecutionResult(input.result),
          },
        },
      };
  }
}

export function buildCliResumeSourceApiResponse(
  input: CliExecuteSourceApiResponseInput
): ResumeSourceApiResponseInit {
  const preview = buildCliSourceApiPreview(input.preview);

  switch (input.kind) {
    case "completed":
      return {
        outcome: {
          case: "completed",
          value: {
            preview,
            result: buildCliSourceApiExecutionResult(input.result),
          },
        },
      };
    case "continued":
      return {
        outcome: {
          case: "continued",
          value: {
            continuationToken: input.continuationToken,
            preview,
            result: buildCliSourceApiExecutionResult(input.result),
          },
        },
      };
  }
}

function copySourceApiHeader(value: Pick<SourceApiHeader, "name" | "value">) {
  return {
    name: value.name.toLowerCase(),
    value: value.value,
  };
}

function buildSourceApiDraftPayload(body: CliSourceApiDraft["body"]): {
  body: SourceApiRequestBody;
  fieldPatch?: SourceApiDraft["fieldPatch"];
} {
  switch (body.case) {
    case "fieldPatch":
      return {
        body: {
          kind: "none",
        },
        fieldPatch: body.value,
      };
    case "jsonBody":
      return {
        body: {
          kind: "json",
          value: toJson(ValueSchema, body.value),
        },
      };
    case "textBody":
      return {
        body: {
          kind: "text",
          value: body.value,
        },
      };
    case "binaryBody":
      return {
        body: {
          kind: "binary",
          value: body.value,
        },
      };
    case undefined:
      return {
        body: {
          kind: "none",
        },
      };
  }
}

function buildCliSourceApiPreview(
  value: SourceApiPreview
): CliSourceApiPreviewInit {
  return {
    bodyKind: toCliSourceApiBodyKind(value.bodyKind),
    bodyPaths: [...value.bodyPaths],
    headerNames: lowerUniqueStrings(value.headerNames),
    host: value.host,
    kind: toCliSourceApiOperationKind(value.kind),
    method: value.method,
    operationName: value.operation,
    paginationPolicy: toCliSourceApiPaginationPolicy(value.paginationPolicy),
    source: buildCliSourceApiSource(value.source),
    selector: value.selector,
    url: value.url,
  };
}

function buildCliSourceApiExecutionResult(
  value: SourceApiExecutionResult
): CliSourceApiExecutionResultInit {
  return {
    body: buildCliSourceApiResponseBody(value.body),
    contentType: value.contentType,
    headers: value.headers.map(copySourceApiHeader),
    operationName: value.operation,
    selector: value.selector,
    source: buildCliSourceApiSource(value.source),
    httpStatusCode: value.status,
  };
}

function buildCliSourceApiOperation(value: SourceApiOperation) {
  return {
    description: value.description,
    examples: value.examples.map(buildCliSourceApiExample),
    fieldPolicy: buildCliSourceApiFieldPolicy(value.fieldPolicy),
    headerPolicy: {
      allowedRequestHeaderNames: lowerUniqueStrings(
        value.headerPolicy.allowedRequestHeaders
      ),
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

function buildCliSourceApiFieldPolicy(value: SourceApiFieldPolicy) {
  return {
    fieldEncodings: [
      ...(value.allowsRawFields ? [SourceApiFieldEncoding.RAW] : []),
      ...(value.allowsTypedFields ? [SourceApiFieldEncoding.TYPED] : []),
    ],
    inputMode: toCliSourceApiInputMode(value.inputMode),
    patchMode: toCliSourceApiPatchMode(value),
    pathCapabilities: [
      ...(value.supportsNestedPaths ? [SourceApiPathCapability.NESTED] : []),
      ...(value.supportsArrayPaths ? [SourceApiPathCapability.ARRAY] : []),
    ],
  };
}

function toCliSourceApiPatchMode(value: SourceApiFieldPolicy) {
  if (!value.allowsRawFields && !value.allowsTypedFields) {
    return SourceApiPatchMode.NONE;
  }

  return value.mergePatches
    ? SourceApiPatchMode.MERGE
    : SourceApiPatchMode.SEPARATE;
}

function lowerUniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function buildCliSourceApiExample(
  value: SourceApiOperation["examples"][number]
) {
  return {
    command: value.command,
    description: value.description,
    label: value.label,
  };
}

function buildCliSourceApiResponseBody(
  value: SourceApiResponseBody
): CliSourceApiExecutionResultInit["body"] {
  switch (value.kind) {
    case "json":
      return {
        case: "json",
        value: fromJson(ValueSchema, value.value),
      };
    case "text":
      return {
        case: "text",
        value: value.value,
      };
    case "binary":
      return {
        case: "binary",
        value: value.value,
      };
    case "none":
      return {
        case: undefined,
        value: undefined,
      };
  }
}

function buildCliSourceApiSource(value: SourceApiSource) {
  return {
    displayName: value.displayName ?? undefined,
    sourceKey: value.sourceKey,
    provider: toCliSourceProvider(value.provider),
  };
}

function toCliSourceApiInputMode(value: SourceApiFieldPolicy["inputMode"]) {
  switch (value) {
    case "none":
      return SourceApiInputMode.NONE;
    case "request_object":
      return SourceApiInputMode.REQUEST_OBJECT;
    case "request_body":
      return SourceApiInputMode.REQUEST_BODY;
  }
}

function toCliSourceApiOperationKind(
  value: SourceApiOperation["kind"]
): SourceApiOperationKind {
  switch (value) {
    case "http_request":
      return SourceApiOperationKind.HTTP_REQUEST;
    case "structured_request":
      return SourceApiOperationKind.STRUCTURED_REQUEST;
  }
}

function toCliSourceApiBodyKind(value: SourceApiBodyFormat): SourceApiBodyKind {
  switch (value) {
    case "none":
      return SourceApiBodyKind.NONE;
    case "json":
      return SourceApiBodyKind.JSON;
    case "text":
      return SourceApiBodyKind.TEXT;
    case "binary":
      return SourceApiBodyKind.BINARY;
  }
}

function toCliSourceApiPaginationPolicy(
  value: SourceApiOperation["paginationPolicy"]
): SourceApiPaginationPolicy {
  switch (value) {
    case "none":
      return SourceApiPaginationPolicy.NONE;
    case "continuation_token":
      return SourceApiPaginationPolicy.CONTINUATION_TOKEN;
  }
}

function toCliSourceApiSelectorKind(
  value: SourceApiOperation["selectorKind"]
): SourceApiSelectorKind {
  switch (value) {
    case "none":
      return SourceApiSelectorKind.NONE;
    case "path":
      return SourceApiSelectorKind.PATH;
    case "identifier":
      return SourceApiSelectorKind.IDENTIFIER;
  }
}
