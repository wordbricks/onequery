import { isFieldSet } from "@bufbuild/protobuf";
import type { AuditSourceApiActionFailureCode } from "@onequery/contracts/audit";
import {
  SourceApiActionCommandPayloadSchema,
  SourceApiActionEventPayloadSchema,
  SourceApiActionFailureCode,
  SourceApiActionInvokeMode,
  SourceApiActionOperationKind,
  SourceApiActionPageFetchSucceededEventSchema,
  SourceApiActionPaginationPolicy,
  SourceApiActionReceivedEventSchema,
  SourceApiActionRequestKind,
  SourceApiActionRequestDescriptorSchema,
  SourceApiActionSourceDescriptorSchema,
} from "@onequery/contracts/workflow/v1/source_api_action_pb";
import type {
  SourceApiActionEventPayload as ProtoSourceApiActionEventPayload,
  SourceApiActionRequestDescriptor as ProtoSourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor as ProtoSourceApiActionSourceDescriptor,
} from "@onequery/contracts/workflow/v1/source_api_action_pb";
import type { ProviderType } from "@onequery/db/server";

import { assertNever, requireProtoMessage } from "./protobuf-utils";
import type { SourceApiActionEventRecord } from "./types";
import {
  assertPayloadType,
  decodeValidatedAuditFeedPayload,
  fromWorkflowSourceProvider,
  readAuditFeedProjectionPayload,
} from "./workflow-payload-codec";

export type SourceApiRequestDescriptorPayload = {
  descriptorVersion: string | null;
  kind: "http_request" | "structured_request" | null;
  method: string | null;
  operation: string;
  paginationPolicy: "continuation_token" | "none" | null;
  selector: string | null;
};

export type SourceApiStartCommandPayload =
  | {
      sourceKey: string;
      type: "start_describe";
    }
  | {
      invokeMode: "execute" | "preview_only";
      requestDescriptor: SourceApiRequestDescriptorPayload;
      sourceKey: string;
      type: "start_invoke";
    };

export type SourceApiSourceDescriptorPayload = {
  displayName: string | null;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
};

export type SourceApiDescriptorResolutionFailureCode = Extract<
  AuditSourceApiActionFailureCode,
  "descriptor_unavailable" | "permission_denied"
>;
export type SourceApiRequestPreparationFailureCode = Extract<
  AuditSourceApiActionFailureCode,
  "execution_state_invalid" | "invalid_request" | "permission_denied"
>;
export type SourceApiPageFetchFailureCode = Extract<
  AuditSourceApiActionFailureCode,
  | "execution_failed"
  | "execution_state_invalid"
  | "invalid_request"
  | "request_timed_out"
>;

export type SourceApiEventPayload =
  | {
      invokeMode: "execute" | "preview_only" | null;
      requestDescriptor: SourceApiRequestDescriptorPayload | null;
      requestKind: "describe" | "invoke";
      type: "action_received";
    }
  | {
      source: SourceApiSourceDescriptorPayload;
      type: "source_loaded";
    }
  | {
      sourceKey: string;
      type: "source_not_found";
    }
  | {
      requestDescriptor: SourceApiRequestDescriptorPayload | null;
      type: "descriptor_resolved";
    }
  | {
      detail: string;
      failureCode: SourceApiDescriptorResolutionFailureCode;
      problemKey: string;
      type: "descriptor_resolution_failed";
    }
  | {
      preparedRequestFingerprint: string;
      type: "request_prepared";
    }
  | {
      detail: string;
      failureCode: SourceApiRequestPreparationFailureCode;
      problemKey: string;
      type: "request_preparation_failed";
    }
  | {
      attemptNumber: number;
      type: "resume_requested";
    }
  | {
      attemptNumber: number;
      contentType: string | null;
      hasContinuation: boolean;
      httpStatus: number;
      pageIndex: number;
      responseBytes: number | null;
      type: "page_fetch_succeeded";
    }
  | {
      attemptNumber: number;
      detail: string;
      failureCode: SourceApiPageFetchFailureCode;
      kind: "terminal_failure";
      pageIndex: number;
      problemKey: string;
      type: "page_fetch_failed";
    };

export function parseSourceApiStartCommand(
  record: SourceApiActionEventRecord
): SourceApiStartCommandPayload {
  return readAuditFeedProjectionPayload({
    entity: "source_api_action_command_payload",
    family: "source_api_action",
    payloadType: record.commandType,
    record,
    read: () => {
      const payload = decodeValidatedAuditFeedPayload(
        SourceApiActionCommandPayloadSchema,
        record.commandPayloadBytes
      );

      switch (payload.command.case) {
        case "startDescribe":
          assertPayloadType({
            actionId: record.actionId,
            actual: "start_describe",
            expected: record.commandType,
            family: "source_api_action",
          });
          return {
            sourceKey: payload.command.value.sourceKey,
            type: "start_describe",
          };
        case "startInvoke":
          assertPayloadType({
            actionId: record.actionId,
            actual: "start_invoke",
            expected: record.commandType,
            family: "source_api_action",
          });
          return {
            invokeMode: fromSourceApiInvokeMode(
              payload.command.value.invokeMode
            ),
            requestDescriptor: fromSourceApiRequestDescriptor(
              payload.command.value.requestDescriptor
            ),
            sourceKey: payload.command.value.sourceKey,
            type: "start_invoke",
          };
        case undefined:
          throw new Error(
            `source_api_action ${record.actionId} command payload is missing its oneof case`
          );
        default:
          throw new Error(
            `source_api_action ${record.actionId} projection expected a start command but loaded ${record.commandType}`
          );
      }
    },
  });
}

export function parseSourceApiEventPayload(
  record: SourceApiActionEventRecord
): SourceApiEventPayload {
  return readAuditFeedProjectionPayload({
    entity: "source_api_action_event_payload",
    family: "source_api_action",
    payloadType: record.eventType,
    record,
    read: () => {
      const payload = decodeValidatedAuditFeedPayload(
        SourceApiActionEventPayloadSchema,
        record.payloadBytes
      );
      const event = fromSourceApiEventPayload(payload);
      assertPayloadType({
        actionId: record.actionId,
        actual: event.type,
        expected: record.eventType,
        family: "source_api_action",
      });
      return event;
    },
  });
}

function fromSourceApiEventPayload(
  payload: ProtoSourceApiActionEventPayload
): SourceApiEventPayload {
  switch (payload.event.case) {
    case "actionReceived":
      return {
        invokeMode: isFieldSet(
          payload.event.value,
          SourceApiActionReceivedEventSchema.field.invokeMode
        )
          ? fromSourceApiInvokeMode(payload.event.value.invokeMode)
          : null,
        requestDescriptor:
          payload.event.value.requestDescriptor === undefined
            ? null
            : fromSourceApiRequestDescriptor(
                payload.event.value.requestDescriptor
              ),
        requestKind: fromSourceApiRequestKind(payload.event.value.requestKind),
        type: "action_received",
      };
    case "sourceLoaded":
      return {
        source: fromSourceApiSourceDescriptor(payload.event.value.source),
        type: "source_loaded",
      };
    case "sourceNotFound":
      return {
        sourceKey: payload.event.value.sourceKey,
        type: "source_not_found",
      };
    case "descriptorResolved":
      return {
        requestDescriptor:
          payload.event.value.requestDescriptor === undefined
            ? null
            : fromSourceApiRequestDescriptor(
                payload.event.value.requestDescriptor
              ),
        type: "descriptor_resolved",
      };
    case "descriptorResolutionFailed": {
      const failureCode = fromDescriptorResolutionFailureCode(
        payload.event.value.failureCode
      );
      return {
        detail: payload.event.value.detail,
        failureCode,
        problemKey: sourceApiProblemKeyForFailure(failureCode),
        type: "descriptor_resolution_failed",
      };
    }
    case "requestPrepared":
      return {
        preparedRequestFingerprint:
          payload.event.value.preparedRequestFingerprint,
        type: "request_prepared",
      };
    case "requestPreparationFailed": {
      const failureCode = fromRequestPreparationFailureCode(
        payload.event.value.failureCode
      );
      return {
        detail: payload.event.value.detail,
        failureCode,
        problemKey: sourceApiProblemKeyForFailure(failureCode),
        type: "request_preparation_failed",
      };
    }
    case "resumeRequested":
      return {
        attemptNumber: payload.event.value.attemptNumber,
        type: "resume_requested",
      };
    case "pageFetchSucceeded":
      return {
        attemptNumber: payload.event.value.attemptNumber,
        contentType: isFieldSet(
          payload.event.value,
          SourceApiActionPageFetchSucceededEventSchema.field.contentType
        )
          ? payload.event.value.contentType
          : null,
        hasContinuation: payload.event.value.hasContinuation,
        httpStatus: payload.event.value.httpStatus,
        pageIndex: payload.event.value.pageIndex,
        responseBytes: isFieldSet(
          payload.event.value,
          SourceApiActionPageFetchSucceededEventSchema.field.responseBytes
        )
          ? Number(payload.event.value.responseBytes)
          : null,
        type: "page_fetch_succeeded",
      };
    case "pageFetchFailed": {
      const failureCode = fromPageFetchFailureCode(
        payload.event.value.failureCode
      );
      return {
        attemptNumber: payload.event.value.attemptNumber,
        detail: payload.event.value.detail,
        failureCode,
        kind: "terminal_failure",
        pageIndex: payload.event.value.pageIndex,
        problemKey: sourceApiProblemKeyForFailure(failureCode),
        type: "page_fetch_failed",
      };
    }
    case undefined:
      throw new Error("source api action event payload missing oneof case");
    default:
      return assertNever(payload.event);
  }
}

function fromSourceApiSourceDescriptor(
  source: ProtoSourceApiActionSourceDescriptor | undefined
): SourceApiSourceDescriptorPayload {
  const value = requireProtoMessage(source, "source");

  return {
    displayName: isFieldSet(
      value,
      SourceApiActionSourceDescriptorSchema.field.displayName
    )
      ? value.displayName
      : null,
    provider: fromWorkflowSourceProvider(value.provider),
    sourceId: value.sourceId,
    sourceKey: value.sourceKey,
  };
}

function fromSourceApiRequestDescriptor(
  descriptor: ProtoSourceApiActionRequestDescriptor | undefined
): SourceApiRequestDescriptorPayload {
  const value = requireProtoMessage(descriptor, "request_descriptor");

  return {
    descriptorVersion: isFieldSet(
      value,
      SourceApiActionRequestDescriptorSchema.field.descriptorVersion
    )
      ? value.descriptorVersion
      : null,
    kind: isFieldSet(value, SourceApiActionRequestDescriptorSchema.field.kind)
      ? fromSourceApiOperationKind(value.kind)
      : null,
    method: isFieldSet(
      value,
      SourceApiActionRequestDescriptorSchema.field.method
    )
      ? value.method
      : null,
    operation: value.operation,
    paginationPolicy: isFieldSet(
      value,
      SourceApiActionRequestDescriptorSchema.field.paginationPolicy
    )
      ? fromSourceApiPaginationPolicy(value.paginationPolicy)
      : null,
    selector: isFieldSet(
      value,
      SourceApiActionRequestDescriptorSchema.field.selector
    )
      ? value.selector
      : null,
  };
}

function fromSourceApiRequestKind(
  kind: SourceApiActionRequestKind
): Extract<SourceApiEventPayload, { type: "action_received" }>["requestKind"] {
  switch (kind) {
    case SourceApiActionRequestKind.DESCRIBE:
      return "describe";
    case SourceApiActionRequestKind.INVOKE:
      return "invoke";
    case SourceApiActionRequestKind.UNSPECIFIED:
      throw new Error("source api request kind is unspecified");
    default:
      throw new Error(`unsupported source api request kind: ${kind}`);
  }
}

function fromSourceApiInvokeMode(
  mode: SourceApiActionInvokeMode
): NonNullable<
  Extract<SourceApiEventPayload, { type: "action_received" }>["invokeMode"]
> {
  switch (mode) {
    case SourceApiActionInvokeMode.PREVIEW_ONLY:
      return "preview_only";
    case SourceApiActionInvokeMode.EXECUTE:
      return "execute";
    case SourceApiActionInvokeMode.UNSPECIFIED:
      throw new Error("source api invoke mode is unspecified");
    default:
      throw new Error(`unsupported source api invoke mode: ${mode}`);
  }
}

function fromSourceApiOperationKind(
  kind: SourceApiActionOperationKind
): NonNullable<SourceApiRequestDescriptorPayload["kind"]> {
  switch (kind) {
    case SourceApiActionOperationKind.HTTP_REQUEST:
      return "http_request";
    case SourceApiActionOperationKind.STRUCTURED_REQUEST:
      return "structured_request";
    case SourceApiActionOperationKind.UNSPECIFIED:
      throw new Error("source api operation kind is unspecified");
    default:
      throw new Error(`unsupported source api operation kind: ${kind}`);
  }
}

function fromSourceApiPaginationPolicy(
  policy: SourceApiActionPaginationPolicy
): NonNullable<SourceApiRequestDescriptorPayload["paginationPolicy"]> {
  switch (policy) {
    case SourceApiActionPaginationPolicy.NONE:
      return "none";
    case SourceApiActionPaginationPolicy.CONTINUATION_TOKEN:
      return "continuation_token";
    case SourceApiActionPaginationPolicy.UNSPECIFIED:
      throw new Error("source api pagination policy is unspecified");
    default:
      throw new Error(`unsupported source api pagination policy: ${policy}`);
  }
}

function fromDescriptorResolutionFailureCode(
  code: SourceApiActionFailureCode
): SourceApiDescriptorResolutionFailureCode {
  switch (code) {
    case SourceApiActionFailureCode.DESCRIPTOR_UNAVAILABLE:
      return "descriptor_unavailable";
    case SourceApiActionFailureCode.PERMISSION_DENIED:
      return "permission_denied";
    default:
      throw new Error(
        `source api descriptor failure code ${code} is not valid for descriptor resolution`
      );
  }
}

function fromRequestPreparationFailureCode(
  code: SourceApiActionFailureCode
): SourceApiRequestPreparationFailureCode {
  switch (code) {
    case SourceApiActionFailureCode.INVALID_REQUEST:
      return "invalid_request";
    case SourceApiActionFailureCode.PERMISSION_DENIED:
      return "permission_denied";
    case SourceApiActionFailureCode.EXECUTION_STATE_INVALID:
      return "execution_state_invalid";
    default:
      throw new Error(
        `source api request preparation failure code ${code} is not valid for request preparation`
      );
  }
}

function fromPageFetchFailureCode(
  code: SourceApiActionFailureCode
): SourceApiPageFetchFailureCode {
  switch (code) {
    case SourceApiActionFailureCode.INVALID_REQUEST:
      return "invalid_request";
    case SourceApiActionFailureCode.REQUEST_TIMED_OUT:
      return "request_timed_out";
    case SourceApiActionFailureCode.EXECUTION_FAILED:
      return "execution_failed";
    case SourceApiActionFailureCode.EXECUTION_STATE_INVALID:
      return "execution_state_invalid";
    default:
      throw new Error(
        `source api page fetch failure code ${code} is not valid for page fetch`
      );
  }
}

function sourceApiProblemKeyForFailure(
  failureCode:
    | SourceApiDescriptorResolutionFailureCode
    | SourceApiPageFetchFailureCode
    | SourceApiRequestPreparationFailureCode
): string {
  switch (failureCode) {
    case "descriptor_unavailable":
      return "SOURCE_API_DESCRIBE_FAILED";
    case "invalid_request":
      return "SOURCE_API_REQUEST_INVALID";
    case "permission_denied":
      return "SOURCE_API_FORBIDDEN";
    case "request_timed_out":
      return "SOURCE_API_EXECUTION_TIMED_OUT";
    case "execution_failed":
      return "SOURCE_API_EXECUTION_FAILED";
    case "execution_state_invalid":
      return "SOURCE_API_EXECUTION_STATE_INVALID";
    default:
      return assertNever(failureCode);
  }
}
