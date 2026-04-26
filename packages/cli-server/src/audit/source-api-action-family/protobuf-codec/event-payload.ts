import { create, isFieldSet } from "@bufbuild/protobuf";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import * as sourceApiPb from "../../../connect/gen/onequery/workflow/v1/source_api_action_pb";
import type { WorkflowStorageCorruptRowError } from "../../storage/errors";
import {
  assertNever,
  convertWorkflowPayload,
  decodeWorkflowPayload,
  encodeWorkflowPayload,
} from "../../storage/protobuf-codec";
import type { SourceApiActionEvent } from "../events";
import {
  fromDescriptorResolutionFailureCode,
  fromPageFetchFailureCode,
  fromRequestPreparationFailureCode,
  fromSourceApiInvokeMode,
  fromSourceApiRequestKind,
  toSourceApiFailureCode,
  toSourceApiInvokeMode,
  toSourceApiRequestKind,
} from "./enums";
import { assertMatchingPayloadType } from "./shared";
import type { SourceApiPayloadDecodeContext } from "./shared";
import {
  fromSourceApiRequestDescriptorMessage,
  fromSourceApiSourceDescriptorMessage,
  toSourceApiRequestDescriptorMessage,
  toSourceApiSourceDescriptorMessage,
} from "./source-api-value-codec";

export function encodeSourceApiActionEventPayload(
  event: SourceApiActionEvent
): Buffer {
  return encodeWorkflowPayload(
    sourceApiPb.SourceApiActionEventPayloadSchema,
    toSourceApiActionEventMessage(event)
  );
}

export function decodeSourceApiActionEventPayload(
  bytes: Buffer,
  context: SourceApiPayloadDecodeContext
): ResultType<SourceApiActionEvent, WorkflowStorageCorruptRowError> {
  const decoded = decodeWorkflowPayload(
    sourceApiPb.SourceApiActionEventPayloadSchema,
    bytes,
    {
      ...context,
      entity: "source_api_action_event_payload",
      family: "source_api_action",
    }
  );
  if (decoded.isErr()) {
    return Result.err(decoded.error);
  }

  return convertWorkflowPayload(
    {
      ...context,
      entity: "source_api_action_event_payload",
      family: "source_api_action",
    },
    () => {
      const event = fromSourceApiActionEventMessage(decoded.value);
      assertMatchingPayloadType(context.payloadType, event.type);
      return event;
    }
  );
}

function toSourceApiActionEventMessage(event: SourceApiActionEvent) {
  switch (event.type) {
    case "action_received":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "actionReceived",
          value: create(sourceApiPb.SourceApiActionReceivedEventSchema, {
            ...(event.invokeMode === null
              ? {}
              : { invokeMode: toSourceApiInvokeMode(event.invokeMode) }),
            ...(event.requestDescriptor === null
              ? {}
              : {
                  requestDescriptor: toSourceApiRequestDescriptorMessage(
                    event.requestDescriptor
                  ),
                }),
            requestKind: toSourceApiRequestKind(event.requestKind),
          }),
        },
      });
    case "source_loaded":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "sourceLoaded",
          value: create(sourceApiPb.SourceApiActionSourceLoadedEventSchema, {
            source: toSourceApiSourceDescriptorMessage(event.source),
          }),
        },
      });
    case "source_not_found":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "sourceNotFound",
          value: create(sourceApiPb.SourceApiActionSourceNotFoundEventSchema, {
            sourceKey: event.sourceKey,
          }),
        },
      });
    case "descriptor_resolved":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "descriptorResolved",
          value: create(
            sourceApiPb.SourceApiActionDescriptorResolvedEventSchema,
            event.requestDescriptor === null
              ? {}
              : {
                  requestDescriptor: toSourceApiRequestDescriptorMessage(
                    event.requestDescriptor
                  ),
                }
          ),
        },
      });
    case "descriptor_resolution_failed":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "descriptorResolutionFailed",
          value: create(
            sourceApiPb.SourceApiActionDescriptorResolutionFailedEventSchema,
            {
              detail: event.detail,
              failureCode: toSourceApiFailureCode(event.failureCode),
            }
          ),
        },
      });
    case "request_prepared":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "requestPrepared",
          value: create(sourceApiPb.SourceApiActionRequestPreparedEventSchema, {
            preparedRequestFingerprint: event.preparedRequestFingerprint,
          }),
        },
      });
    case "request_preparation_failed":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "requestPreparationFailed",
          value: create(
            sourceApiPb.SourceApiActionRequestPreparationFailedEventSchema,
            {
              detail: event.detail,
              failureCode: toSourceApiFailureCode(event.failureCode),
            }
          ),
        },
      });
    case "resume_requested":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "resumeRequested",
          value: create(sourceApiPb.SourceApiActionResumeRequestedEventSchema, {
            attemptNumber: event.attemptNumber,
          }),
        },
      });
    case "page_fetch_succeeded":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "pageFetchSucceeded",
          value: create(
            sourceApiPb.SourceApiActionPageFetchSucceededEventSchema,
            {
              attemptNumber: event.attemptNumber,
              ...(event.contentType === null
                ? {}
                : { contentType: event.contentType }),
              hasContinuation: event.hasContinuation,
              httpStatus: event.httpStatus,
              pageIndex: event.pageIndex,
              ...(event.responseBytes === null
                ? {}
                : { responseBytes: BigInt(event.responseBytes) }),
            }
          ),
        },
      });
    case "page_fetch_failed":
      return create(sourceApiPb.SourceApiActionEventPayloadSchema, {
        event: {
          case: "pageFetchFailed",
          value: create(sourceApiPb.SourceApiActionPageFetchFailedEventSchema, {
            attemptNumber: event.attemptNumber,
            detail: event.detail,
            failureCode: toSourceApiFailureCode(event.failureCode),
            pageIndex: event.pageIndex,
          }),
        },
      });
    default:
      return assertNever(event);
  }
}

function fromSourceApiActionEventMessage(
  payload: sourceApiPb.SourceApiActionEventPayload
): SourceApiActionEvent {
  switch (payload.event.case) {
    case "actionReceived":
      return {
        invokeMode: isFieldSet(
          payload.event.value,
          sourceApiPb.SourceApiActionReceivedEventSchema.field.invokeMode
        )
          ? fromSourceApiInvokeMode(payload.event.value.invokeMode)
          : null,
        requestDescriptor:
          payload.event.value.requestDescriptor === undefined
            ? null
            : fromSourceApiRequestDescriptorMessage(
                payload.event.value.requestDescriptor
              ),
        requestKind: fromSourceApiRequestKind(payload.event.value.requestKind),
        type: "action_received",
      };
    case "sourceLoaded":
      return {
        source: fromSourceApiSourceDescriptorMessage(
          payload.event.value.source
        ),
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
            : fromSourceApiRequestDescriptorMessage(
                payload.event.value.requestDescriptor
              ),
        type: "descriptor_resolved",
      };
    case "descriptorResolutionFailed": {
      return {
        detail: payload.event.value.detail,
        failureCode: fromDescriptorResolutionFailureCode(
          payload.event.value.failureCode
        ),
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
      return {
        detail: payload.event.value.detail,
        failureCode: fromRequestPreparationFailureCode(
          payload.event.value.failureCode
        ),
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
          sourceApiPb.SourceApiActionPageFetchSucceededEventSchema.field
            .contentType
        )
          ? payload.event.value.contentType
          : null,
        hasContinuation: payload.event.value.hasContinuation,
        httpStatus: payload.event.value.httpStatus,
        pageIndex: payload.event.value.pageIndex,
        responseBytes: isFieldSet(
          payload.event.value,
          sourceApiPb.SourceApiActionPageFetchSucceededEventSchema.field
            .responseBytes
        )
          ? Number(payload.event.value.responseBytes)
          : null,
        type: "page_fetch_succeeded",
      };
    case "pageFetchFailed": {
      return {
        attemptNumber: payload.event.value.attemptNumber,
        detail: payload.event.value.detail,
        failureCode: fromPageFetchFailureCode(payload.event.value.failureCode),
        kind: "terminal_failure",
        pageIndex: payload.event.value.pageIndex,
        type: "page_fetch_failed",
      };
    }
    case undefined:
      throw new Error("source api action event payload missing oneof case");
    default:
      return assertNever(payload.event);
  }
}
