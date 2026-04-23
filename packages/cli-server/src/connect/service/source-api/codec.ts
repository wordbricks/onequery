import { fromJson, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
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
  SourceApiExecuteMode,
  SourceApiInputMode,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  SourceApiSelectorKind,
} from "../../gen/onequery/cli/v1/source_api_pb";
import type { SourceApiDraft as CliSourceApiDraft } from "../../gen/onequery/cli/v1/source_api_pb";
import { cliServiceErr } from "../result";
import type { CliServiceResult } from "../result";
import { toCliSourceProvider } from "../source-provider";
import type {
  CliExecuteSourceApiInput,
  CliSourceApiExecutionResultInit,
  CliSourceApiPreviewInit,
  DescribeSourceApiResponseInit,
  ExecuteSourceApiResponseInit,
  SourceApiExecuteCommand,
  SourceApiTarget,
} from "./types";

export function resolveSourceApiExecuteCommand(
  input: CliExecuteSourceApiInput
): CliServiceResult<SourceApiExecuteCommand> {
  switch (input.case) {
    case "start":
      if (!input.value.target) {
        return cliServiceErr({
          detail: "source API request missing target payload",
          key: "SOURCE_REQUEST_INVALID",
        });
      }

      if (input.value.draft) {
        return Result.ok({
          draft: input.value.draft,
          kind: "start",
          mode: input.value.mode,
          target: buildSourceApiTarget(input.value.target),
        });
      }

      return cliServiceErr({
        detail: "source API request missing draft payload",
        key: "SOURCE_REQUEST_INVALID",
      });
    case "resume":
      if (!input.value.target) {
        return cliServiceErr({
          detail: "source API request missing target payload",
          key: "SOURCE_REQUEST_INVALID",
        });
      }

      return Result.ok({
        continuationToken: input.value.continuationToken,
        kind: "resume",
        target: buildSourceApiTarget(input.value.target),
      });
    case undefined:
      return cliServiceErr({
        detail: "source API request missing execution input",
        key: "SOURCE_REQUEST_INVALID",
      });
  }
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

export function isCliSourceApiPreviewOnlyMode(
  value: SourceApiExecuteMode
): boolean {
  return value === SourceApiExecuteMode.PREVIEW_ONLY;
}

export function buildSourceApiDraft(
  request: CliSourceApiDraft
): SourceApiDraft {
  return {
    body: buildSourceApiRequestBody(request.body),
    descriptorVersion: request.descriptorVersion,
    fieldPatch: request.fieldPatch,
    headers: request.headers.map(copySourceApiHeader),
    methodOverride: request.methodOverride,
    operation: request.operation,
    selector: request.selector,
  };
}

export function buildCliDescribeSourceApiResponse(
  value: SourceApiDescriptor
): DescribeSourceApiResponseInit {
  return {
    defaultPathOperation: value.defaultPathOperation,
    descriptorVersion: value.descriptorVersion,
    examples: value.examples.map(buildCliSourceApiExample),
    notes: [...value.notes],
    operations: value.operations.map(buildCliSourceApiOperation),
    source: buildCliSourceApiSource(value.source),
  };
}

export function buildCliExecuteSourceApiResponse(input: {
  continuationToken?: string;
  preview: SourceApiPreview;
  result?: SourceApiExecutionResult;
}): ExecuteSourceApiResponseInit {
  const preview = buildCliSourceApiPreview(input.preview);

  if (!input.result) {
    return {
      outcome: {
        case: "previewOnly",
        value: { preview },
      },
    };
  }

  const result = buildCliSourceApiExecutionResult(input.result);

  if (input.continuationToken) {
    return {
      outcome: {
        case: "continued",
        value: {
          continuationToken: input.continuationToken,
          preview,
          result,
        },
      },
    };
  }

  return {
    outcome: {
      case: "completed",
      value: {
        preview,
        result,
      },
    },
  };
}

function copySourceApiHeader(value: Pick<SourceApiHeader, "name" | "value">) {
  return {
    name: value.name,
    value: value.value,
  };
}

function buildSourceApiRequestBody(
  body: CliSourceApiDraft["body"]
): SourceApiRequestBody {
  switch (body.case) {
    case "jsonBody":
      return {
        kind: "json",
        value: toJson(ValueSchema, body.value),
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

function buildCliSourceApiPreview(
  value: SourceApiPreview
): CliSourceApiPreviewInit {
  return {
    bodyKind: toCliSourceApiBodyKind(value.bodyKind),
    bodyPaths: [...value.bodyPaths],
    headerNames: [...value.headerNames],
    host: value.host,
    kind: toCliSourceApiOperationKind(value.kind),
    method: value.method,
    operation: value.operation,
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
    operation: value.operation,
    selector: value.selector,
    source: buildCliSourceApiSource(value.source),
    status: value.status,
  };
}

function buildCliSourceApiOperation(value: SourceApiOperation) {
  return {
    description: value.description,
    examples: value.examples.map(buildCliSourceApiExample),
    fieldPolicy: buildCliSourceApiFieldPolicy(value.fieldPolicy),
    headerPolicy: {
      allowedRequestHeaderNames: [...value.headerPolicy.allowedRequestHeaders],
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
    acceptsInput: value.acceptsInput,
    allowsRawFields: value.allowsRawFields,
    allowsTypedFields: value.allowsTypedFields,
    inputMode: toCliSourceApiInputMode(value.inputMode),
    mergePatches: value.mergePatches,
    supportsArrayPaths: value.supportsArrayPaths,
    supportsNestedPaths: value.supportsNestedPaths,
  };
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
        value: fromJson(ValueSchema, value.value as JsonValue),
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
