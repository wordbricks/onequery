import { Buffer } from "node:buffer";

import type {
  SourceApiDescriptor,
  SourceApiDraft,
  SourceApiExecutionResult,
} from "@onequery/server/source-api";

import type {
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
} from "../../../audit";
import type { CliQuerySourceRecord } from "../../../domain/workflows";
import { createCliServiceFailure } from "../result";
import {
  createSourceApiAuditCorruptionFailure,
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
      throw createSourceApiAuditCorruptionFailure(
        `source_api_action replay expected a source lookup event but loaded ${event.type}`
      );
  }
}

export function toStoredDescriptorResolutionResult(
  commandPayload: StoredAcceptedSourceApiActionResultCommand["commandPayload"]
): DescriptorResolutionResult {
  if (commandPayload.type !== "record_descriptor_resolution") {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action replay expected a descriptor resolution command but loaded ${commandPayload.type}`
    );
  }

  if (commandPayload.kind === "resolved") {
    return {
      descriptor: commandPayload.descriptor,
      kind: "resolved",
    };
  }

  return {
    kind: "failed",
    problem: createCliServiceFailure({
      detail: commandPayload.detail,
      key: commandPayload.problemKey,
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
        problem: createCliServiceFailure({
          detail: event.detail,
          key: event.problemKey,
        }),
      };
    default:
      throw createSourceApiAuditCorruptionFailure(
        `source_api_action replay expected a request preparation event but loaded ${event.type}`
      );
  }
}

export function toStoredPageFetchResult(
  commandPayload: StoredAcceptedSourceApiActionResultCommand["commandPayload"]
): PageFetchResult {
  if (commandPayload.type !== "record_page_fetch") {
    throw createSourceApiAuditCorruptionFailure(
      `source_api_action replay expected a page fetch command but loaded ${commandPayload.type}`
    );
  }

  switch (commandPayload.kind) {
    case "succeeded":
      return {
        kind: "succeeded",
        result: commandPayload.executionResult,
      };
    case "terminal_failure":
      return {
        kind: "failed",
        problem: createCliServiceFailure({
          detail: commandPayload.detail,
          key: commandPayload.problemKey,
        }),
      };
  }
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
