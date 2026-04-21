import { Buffer } from "node:buffer";

import { PROVIDER_TYPES } from "@onequery/db/server";
import type {
  SourceApiDescriptor,
  SourceApiDraft,
  SourceApiExecutionResult,
} from "@onequery/server/source-api";
import { z } from "zod";

import type {
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
  StoredSourceApiExecutionResult,
} from "../../../audit";
import type { CliQuerySourceRecord } from "../../../domain/workflows";
import { createCliServiceProblem } from "../result";
import {
  createSourceApiAuditProblem,
  requireLastCommittedEvent,
} from "./workflow-runtime";
import type {
  DescriptorResolutionResult,
  PageFetchResult,
  RequestPreparationResult,
  SourceApiSourceLookupResult,
  StoredAcceptedSourceApiActionDecision,
  StoredAcceptedSourceApiActionResultCommand,
} from "./workflow-types";

const JsonValueSchema: z.ZodType<import("@bufbuild/protobuf").JsonValue> =
  z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(JsonValueSchema),
      z.record(z.string(), JsonValueSchema),
    ])
  );

const SourceApiSourceSchema = z
  .object({
    displayName: z.string().nullable().optional(),
    provider: z.enum(PROVIDER_TYPES),
    sourceKey: z.string(),
  })
  .strict();

const SourceApiHeaderSchema = z
  .object({
    name: z.string(),
    value: z.string(),
  })
  .strict();

const SourceApiExampleSchema = z
  .object({
    command: z.string(),
    description: z.string().optional(),
    label: z.string(),
  })
  .strict();

const SourceApiOperationSchema = z
  .object({
    description: z.string(),
    examples: z.array(SourceApiExampleSchema),
    fieldPolicy: z
      .object({
        acceptsInput: z.boolean(),
        allowsRawFields: z.boolean(),
        allowsTypedFields: z.boolean(),
        inputMode: z.enum(["none", "request_object", "request_body"]),
        mergePatches: z.boolean(),
        supportsArrayPaths: z.boolean(),
        supportsNestedPaths: z.boolean(),
      })
      .strict(),
    headerPolicy: z
      .object({
        allowedRequestHeaders: z.array(z.string()),
        allowedResponseHeaders: z.array(z.string()),
      })
      .strict(),
    kind: z.enum(["http_request", "structured_request"]),
    methodPolicy: z
      .object({
        allowedMethods: z.array(z.string()),
        defaultMethod: z.string().optional(),
      })
      .strict(),
    name: z.string(),
    notes: z.array(z.string()),
    paginationPolicy: z.enum(["none", "continuation_token"]),
    selectorKind: z.enum(["none", "path", "identifier"]),
    selectorLabel: z.string().optional(),
    summary: z.string(),
  })
  .strict();

const SourceApiDescriptorSchema = z
  .object({
    defaultPathOperation: z.string().optional(),
    descriptorVersion: z.string(),
    examples: z.array(SourceApiExampleSchema),
    notes: z.array(z.string()),
    operations: z.array(SourceApiOperationSchema),
    source: SourceApiSourceSchema,
  })
  .strict();

const StoredSourceApiResponseBodySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("none"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json"),
      value: JsonValueSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      value: z.string(),
    })
    .strict(),
  z
    .object({
      base64: z.string(),
      kind: z.literal("binary"),
    })
    .strict(),
]);

const StoredSourceApiExecutionResultSchema = z
  .object({
    body: StoredSourceApiResponseBodySchema,
    contentType: z.string(),
    headers: z.array(SourceApiHeaderSchema),
    nextContinuationState: JsonValueSchema.optional(),
    operation: z.string(),
    selector: z.string().optional(),
    source: SourceApiSourceSchema,
    status: z.number().int(),
  })
  .strict();

const StoredDescriptorResolutionResultPayloadSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        descriptor: SourceApiDescriptorSchema,
        kind: z.literal("resolved"),
        requestDescriptor: z.unknown().nullable(),
        type: z.literal("record_descriptor_resolution"),
      })
      .strict(),
    z
      .object({
        detail: z.string(),
        failureCode: z.enum(["descriptor_unavailable", "permission_denied"]),
        kind: z.literal("failed"),
        type: z.literal("record_descriptor_resolution"),
      })
      .strict(),
  ]
);

const StoredPageFetchResultPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      attemptNumber: z.number().int(),
      contentType: z.string().nullable(),
      executionResult: StoredSourceApiExecutionResultSchema,
      hasContinuation: z.boolean(),
      httpStatus: z.number().int(),
      kind: z.literal("succeeded"),
      pageIndex: z.number().int(),
      responseBytes: z.number().int().nullable(),
      type: z.literal("record_page_fetch"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      detail: z.string(),
      kind: z.literal("retryable_failure"),
      pageIndex: z.number().int(),
      type: z.literal("record_page_fetch"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      detail: z.string(),
      failureCode: z.enum([
        "request_failed",
        "request_timed_out",
        "execution_failed",
        "execution_state_invalid",
      ]),
      kind: z.literal("terminal_failure"),
      pageIndex: z.number().int(),
      type: z.literal("record_page_fetch"),
    })
    .strict(),
]);

export function toStoredSourceLookupResult(
  decision: StoredAcceptedSourceApiActionDecision
): SourceApiSourceLookupResult {
  const event = requireLastCommittedEvent(decision);

  switch (event.type) {
    case "source_loaded":
      return {
        kind: "found",
      };
    case "source_not_found":
      return {
        kind: "not_found",
      };
    default:
      throw createSourceApiAuditProblem(
        `source_api_action replay expected a source lookup event but loaded ${event.type}`
      );
  }
}

export function toStoredDescriptorResolutionResult(
  commandPayload: StoredAcceptedSourceApiActionResultCommand["commandPayload"]
): DescriptorResolutionResult {
  const parsed =
    StoredDescriptorResolutionResultPayloadSchema.safeParse(commandPayload);
  if (!parsed.success) {
    throw createSourceApiAuditProblem(
      "source_api_action stored descriptor resolution payload is corrupt",
      parsed.error
    );
  }

  if (parsed.data.kind === "resolved") {
    return {
      descriptor: parsed.data.descriptor,
      kind: "resolved",
    };
  }

  return {
    kind: "failed",
    problem: createCliServiceProblem({
      detail: parsed.data.detail,
      key:
        parsed.data.failureCode === "permission_denied"
          ? "SOURCE_API_FORBIDDEN"
          : "SOURCE_API_SOURCE_UNAVAILABLE",
    }),
  };
}

export function toStoredRequestPreparationResult(
  decision: StoredAcceptedSourceApiActionDecision
): RequestPreparationResult {
  const event = requireLastCommittedEvent(decision);

  switch (event.type) {
    case "request_prepared":
      return {
        kind: "prepared",
      };
    case "request_preparation_failed":
      return {
        kind: "failed",
        problem: createCliServiceProblem({
          detail: event.detail,
          key:
            event.failureCode === "permission_denied"
              ? "SOURCE_API_FORBIDDEN"
              : "SOURCE_REQUEST_INVALID",
        }),
      };
    default:
      throw createSourceApiAuditProblem(
        `source_api_action replay expected a request preparation event but loaded ${event.type}`
      );
  }
}

export function toStoredPageFetchResult(
  commandPayload: StoredAcceptedSourceApiActionResultCommand["commandPayload"]
): PageFetchResult {
  const parsed = StoredPageFetchResultPayloadSchema.safeParse(commandPayload);
  if (!parsed.success) {
    throw createSourceApiAuditProblem(
      "source_api_action stored page fetch payload is corrupt",
      parsed.error
    );
  }

  switch (parsed.data.kind) {
    case "succeeded":
      return {
        kind: "succeeded",
        result: decodeStoredSourceApiExecutionResult(
          parsed.data.executionResult
        ),
      };
    case "retryable_failure":
      return {
        kind: "failed",
        problem: createCliServiceProblem({
          detail: parsed.data.detail,
          key: "SOURCE_API_EXECUTION_FAILED",
        }),
      };
    case "terminal_failure":
      return {
        kind: "failed",
        problem: createCliServiceProblem({
          detail: parsed.data.detail,
          key: toCliServiceProblemKeyForPageFetchFailure(
            parsed.data.failureCode
          ),
        }),
      };
  }
}

export function encodeStoredSourceApiExecutionResult(
  result: SourceApiExecutionResult
): StoredSourceApiExecutionResult {
  return {
    body: encodeStoredSourceApiResponseBody(result.body),
    contentType: result.contentType,
    headers: [...result.headers],
    ...(result.nextContinuationState === undefined
      ? {}
      : { nextContinuationState: result.nextContinuationState }),
    operation: result.operation,
    ...(result.selector === undefined ? {} : { selector: result.selector }),
    source: result.source,
    status: result.status,
  };
}

export function toSourceApiActionSourceDescriptor(
  source: Pick<
    CliQuerySourceRecord,
    "displayName" | "id" | "provider" | "sourceKey"
  >
): SourceApiActionSourceDescriptor {
  return {
    displayName: source.displayName,
    provider: source.provider,
    sourceId: source.id,
    sourceKey: source.sourceKey,
  };
}

export function buildInitialRequestDescriptor(
  draft: Pick<
    SourceApiDraft,
    "descriptorVersion" | "methodOverride" | "operation" | "selector"
  >
): SourceApiActionRequestDescriptor {
  return {
    descriptorVersion: draft.descriptorVersion ?? null,
    kind: null,
    method: draft.methodOverride ?? null,
    operation: draft.operation,
    paginationPolicy: null,
    selector: draft.selector ?? null,
  };
}

export function buildResolvedRequestDescriptor(input: {
  descriptor: SourceApiDescriptor;
  draft: Pick<SourceApiDraft, "methodOverride" | "operation" | "selector">;
}): SourceApiActionRequestDescriptor {
  const operation =
    input.descriptor.operations.find(
      (candidate) => candidate.name === input.draft.operation.trim()
    ) ?? null;

  return {
    descriptorVersion: input.descriptor.descriptorVersion,
    kind: operation?.kind ?? null,
    method:
      input.draft.methodOverride ??
      operation?.methodPolicy.defaultMethod ??
      null,
    operation: input.draft.operation,
    paginationPolicy: operation?.paginationPolicy ?? null,
    selector: input.draft.selector ?? null,
  };
}

export function measureSourceApiResponseBytes(
  result: SourceApiExecutionResult
) {
  switch (result.body.kind) {
    case "binary":
      return result.body.value.byteLength;
    case "json":
      return Buffer.byteLength(JSON.stringify(result.body.value), "utf8");
    case "text":
      return Buffer.byteLength(result.body.value, "utf8");
    case "none":
      return null;
  }
}

function decodeStoredSourceApiExecutionResult(
  result: StoredSourceApiExecutionResult
): SourceApiExecutionResult {
  return {
    body: decodeStoredSourceApiResponseBody(result.body),
    contentType: result.contentType,
    headers: [...result.headers],
    ...(result.nextContinuationState === undefined
      ? {}
      : { nextContinuationState: result.nextContinuationState }),
    operation: result.operation,
    ...(result.selector === undefined ? {} : { selector: result.selector }),
    source: result.source,
    status: result.status,
  };
}

function encodeStoredSourceApiResponseBody(
  body: SourceApiExecutionResult["body"]
) {
  switch (body.kind) {
    case "binary":
      return {
        base64: Buffer.from(body.value).toString("base64"),
        kind: "binary" as const,
      };
    case "json":
      return {
        kind: "json" as const,
        value: body.value,
      };
    case "text":
      return {
        kind: "text" as const,
        value: body.value,
      };
    case "none":
      return {
        kind: "none" as const,
      };
  }
}

function decodeStoredSourceApiResponseBody(
  body: StoredSourceApiExecutionResult["body"]
): SourceApiExecutionResult["body"] {
  switch (body.kind) {
    case "binary":
      return {
        kind: "binary",
        value: Buffer.from(body.base64, "base64"),
      };
    case "json":
      return {
        kind: "json",
        value: body.value as never,
      };
    case "text":
      return {
        kind: "text",
        value: body.value,
      };
    case "none":
      return {
        kind: "none",
      };
  }
}

function toCliServiceProblemKeyForPageFetchFailure(
  failureCode:
    | "execution_failed"
    | "execution_state_invalid"
    | "request_failed"
    | "request_timed_out"
) {
  switch (failureCode) {
    case "execution_state_invalid":
      return "SOURCE_API_EXECUTION_STATE_INVALID" as const;
    case "request_failed":
    case "request_timed_out":
    case "execution_failed":
      return "SOURCE_API_EXECUTION_FAILED" as const;
  }
}
