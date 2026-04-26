import { create, fromJson, isFieldSet, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import type { ProviderType } from "@onequery/db/server";
import type {
  SourceApiDescriptor,
  SourceApiFieldPolicy,
  SourceApiHeaderPolicy,
  SourceApiMethodPolicy,
  SourceApiOperation,
  SourceApiOperationKind,
  SourceApiPaginationPolicy,
  SourceApiSelectorKind,
  SourceApiSource,
} from "@onequery/server/source-api";
import { canonicalizeSourceApiHeaderNames } from "@onequery/server/source-api/header-policy";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import * as commonPb from "../../connect/gen/onequery/workflow/v1/common_pb";
import * as sourceApiPb from "../../connect/gen/onequery/workflow/v1/source_api_action_pb";
import { WorkflowStorageCorruptRowError } from "../storage/errors";
import {
  assertNever,
  convertWorkflowPayload,
  decodeWorkflowPayload,
  encodeWorkflowPayload,
} from "../storage/protobuf-codec";
import type { WorkflowPayloadCodecContext } from "../storage/protobuf-codec";
import type { SourceApiActionCommandPayload } from "./commands";
import type {
  SourceApiActionInvokeMode,
  SourceApiActionRequestDescriptor,
  SourceApiActionRequestKind,
  SourceApiActionSourceDescriptor,
  StoredSourceApiExecutionResult,
} from "./descriptors";
import type { SourceApiActionEffect } from "./effects";
import type { SourceApiActionEvent } from "./events";
import type { SourceApiActionFailureCode } from "./state";

type SourceApiPayloadDecodeContext = Omit<
  WorkflowPayloadCodecContext,
  "entity" | "family" | "payloadType"
> & {
  payloadType: string;
};

export function encodeSourceApiActionCommandPayload(
  payload: SourceApiActionCommandPayload
): Buffer {
  return encodeWorkflowPayload(
    sourceApiPb.SourceApiActionCommandPayloadSchema,
    toSourceApiActionCommandMessage(payload)
  );
}

export function getSourceApiActionCommandPayloadType(
  payload: SourceApiActionCommandPayload
): string {
  switch (payload.type) {
    case "start_describe":
      return "start_describe";
    case "start_invoke":
      return "start_invoke";
    case "resume_invoke":
      return "resume_invoke";
    case "record_source_lookup":
      switch (payload.kind) {
        case "found":
          return "record_source_found";
        case "not_found":
          return "record_source_not_found";
        default:
          return assertNever(payload);
      }
    case "record_descriptor_resolution":
      switch (payload.kind) {
        case "resolved":
          return "record_descriptor_resolved";
        case "failed":
          return "record_descriptor_resolution_failed";
        default:
          return assertNever(payload);
      }
    case "record_request_preparation":
      switch (payload.kind) {
        case "prepared":
          return "record_request_prepared";
        case "failed":
          return "record_request_preparation_failed";
        default:
          return assertNever(payload);
      }
    case "record_page_fetch":
      switch (payload.kind) {
        case "succeeded":
          return "record_page_fetch_succeeded";
        case "terminal_failure":
          return "record_page_fetch_terminal_failure";
        default:
          return assertNever(payload);
      }
    default:
      return assertNever(payload);
  }
}

export function decodeSourceApiActionCommandPayload(
  bytes: Buffer,
  context: SourceApiPayloadDecodeContext
): ResultType<SourceApiActionCommandPayload, WorkflowStorageCorruptRowError> {
  const decoded = decodeWorkflowPayload(
    sourceApiPb.SourceApiActionCommandPayloadSchema,
    bytes,
    {
      ...context,
      entity: "source_api_action_command_payload",
      family: "source_api_action",
    }
  );
  if (decoded.isErr()) {
    return Result.err(decoded.error);
  }

  return convertWorkflowPayload(
    {
      ...context,
      entity: "source_api_action_command_payload",
      family: "source_api_action",
    },
    () => {
      const payloadType = getSourceApiActionCommandPayloadTypeFromOneofCase(
        decoded.value.command.case
      );
      assertMatchingPayloadType(context.payloadType, payloadType);
      const payload = fromSourceApiActionCommandMessage(decoded.value);
      return payload;
    }
  );
}

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

export function encodeSourceApiActionEffectPayload(
  effect: SourceApiActionEffect
): Buffer {
  return encodeWorkflowPayload(
    sourceApiPb.SourceApiActionEffectPayloadSchema,
    toSourceApiActionEffectMessage(effect)
  );
}

export function decodeSourceApiActionEffectPayload(
  bytes: Buffer,
  context: SourceApiPayloadDecodeContext
): ResultType<SourceApiActionEffect, WorkflowStorageCorruptRowError> {
  const decoded = decodeWorkflowPayload(
    sourceApiPb.SourceApiActionEffectPayloadSchema,
    bytes,
    {
      ...context,
      entity: "source_api_action_effect_payload",
      family: "source_api_action",
    }
  );
  if (decoded.isErr()) {
    return Result.err(decoded.error);
  }

  return convertWorkflowPayload(
    {
      ...context,
      entity: "source_api_action_effect_payload",
      family: "source_api_action",
    },
    () => {
      const effect = fromSourceApiActionEffectMessage(decoded.value);
      assertMatchingPayloadType(context.payloadType, effect.type);
      return effect;
    }
  );
}

function toSourceApiActionCommandMessage(
  payload: SourceApiActionCommandPayload
) {
  switch (payload.type) {
    case "start_describe":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "startDescribe",
          value: create(sourceApiPb.SourceApiActionStartDescribeCommandSchema, {
            sourceKey: payload.sourceKey,
          }),
        },
      });
    case "start_invoke":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "startInvoke",
          value: create(sourceApiPb.SourceApiActionStartInvokeCommandSchema, {
            invokeMode: toSourceApiInvokeMode(payload.invokeMode),
            requestDescriptor: toSourceApiRequestDescriptorMessage(
              payload.requestDescriptor
            ),
            sourceKey: payload.sourceKey,
          }),
        },
      });
    case "resume_invoke":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "resumeInvoke",
          value: create(sourceApiPb.SourceApiActionResumeInvokeCommandSchema, {
            preparedRequestFingerprint: payload.preparedRequestFingerprint,
            resumeFromEventId: payload.resumeFromEventId,
          }),
        },
      });
    case "record_source_lookup":
      return toSourceLookupCommandMessage(payload);
    case "record_descriptor_resolution":
      return toDescriptorResolutionCommandMessage(payload);
    case "record_request_preparation":
      return toRequestPreparationCommandMessage(payload);
    case "record_page_fetch":
      return toPageFetchCommandMessage(payload);
    default:
      return assertNever(payload);
  }
}

function toSourceLookupCommandMessage(
  payload: Extract<
    SourceApiActionCommandPayload,
    { type: "record_source_lookup" }
  >
) {
  switch (payload.kind) {
    case "found":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "recordSourceFound",
          value: create(
            sourceApiPb.SourceApiActionRecordSourceFoundCommandSchema,
            {
              source: toSourceApiSourceDescriptorMessage(payload.source),
            }
          ),
        },
      });
    case "not_found":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "recordSourceNotFound",
          value: create(
            sourceApiPb.SourceApiActionRecordSourceNotFoundCommandSchema,
            { sourceKey: payload.sourceKey }
          ),
        },
      });
    default:
      return assertNever(payload);
  }
}

function toDescriptorResolutionCommandMessage(
  payload: Extract<
    SourceApiActionCommandPayload,
    { type: "record_descriptor_resolution" }
  >
) {
  switch (payload.kind) {
    case "resolved":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "recordDescriptorResolved",
          value: create(
            sourceApiPb.SourceApiActionRecordDescriptorResolvedCommandSchema,
            {
              descriptor: toSourceApiDescriptorMessage(payload.descriptor),
              ...(payload.requestDescriptor === null
                ? {}
                : {
                    requestDescriptor: toSourceApiRequestDescriptorMessage(
                      payload.requestDescriptor
                    ),
                  }),
            }
          ),
        },
      });
    case "failed":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "recordDescriptorResolutionFailed",
          value: create(
            sourceApiPb.SourceApiActionRecordDescriptorResolutionFailedCommandSchema,
            {
              detail: payload.detail,
              failureCode: toSourceApiFailureCode(payload.failureCode),
            }
          ),
        },
      });
    default:
      return assertNever(payload);
  }
}

function toRequestPreparationCommandMessage(
  payload: Extract<
    SourceApiActionCommandPayload,
    { type: "record_request_preparation" }
  >
) {
  switch (payload.kind) {
    case "prepared":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "recordRequestPrepared",
          value: create(
            sourceApiPb.SourceApiActionRecordRequestPreparedCommandSchema,
            {
              preparedRequestFingerprint: payload.preparedRequestFingerprint,
            }
          ),
        },
      });
    case "failed":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "recordRequestPreparationFailed",
          value: create(
            sourceApiPb.SourceApiActionRecordRequestPreparationFailedCommandSchema,
            {
              detail: payload.detail,
              failureCode: toSourceApiFailureCode(payload.failureCode),
            }
          ),
        },
      });
    default:
      return assertNever(payload);
  }
}

function toPageFetchCommandMessage(
  payload: Extract<SourceApiActionCommandPayload, { type: "record_page_fetch" }>
) {
  switch (payload.kind) {
    case "succeeded":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "recordPageFetchSucceeded",
          value: create(
            sourceApiPb.SourceApiActionRecordPageFetchSucceededCommandSchema,
            {
              attemptNumber: payload.attemptNumber,
              ...(payload.contentType === null
                ? {}
                : { contentType: payload.contentType }),
              executionResult: toSourceApiExecutionResultMessage(
                payload.executionResult
              ),
              hasContinuation: payload.hasContinuation,
              httpStatus: payload.httpStatus,
              pageIndex: payload.pageIndex,
              ...(payload.responseBytes === null
                ? {}
                : { responseBytes: BigInt(payload.responseBytes) }),
            }
          ),
        },
      });
    case "terminal_failure":
      return create(sourceApiPb.SourceApiActionCommandPayloadSchema, {
        command: {
          case: "recordPageFetchTerminalFailure",
          value: create(
            sourceApiPb.SourceApiActionRecordPageFetchTerminalFailureCommandSchema,
            {
              attemptNumber: payload.attemptNumber,
              detail: payload.detail,
              failureCode: toSourceApiFailureCode(payload.failureCode),
              pageIndex: payload.pageIndex,
            }
          ),
        },
      });
    default:
      return assertNever(payload);
  }
}

function fromSourceApiActionCommandMessage(
  payload: sourceApiPb.SourceApiActionCommandPayload
): SourceApiActionCommandPayload {
  switch (payload.command.case) {
    case "startDescribe":
      return {
        sourceKey: payload.command.value.sourceKey,
        type: "start_describe",
      };
    case "startInvoke":
      return {
        invokeMode: fromSourceApiInvokeMode(payload.command.value.invokeMode),
        requestDescriptor: fromSourceApiRequestDescriptorMessage(
          payload.command.value.requestDescriptor
        ),
        sourceKey: payload.command.value.sourceKey,
        type: "start_invoke",
      };
    case "resumeInvoke":
      return {
        preparedRequestFingerprint:
          payload.command.value.preparedRequestFingerprint,
        resumeFromEventId: payload.command.value.resumeFromEventId,
        type: "resume_invoke",
      };
    case "recordSourceFound":
      return {
        kind: "found",
        source: fromSourceApiSourceDescriptorMessage(
          payload.command.value.source
        ),
        type: "record_source_lookup",
      };
    case "recordSourceNotFound":
      return {
        kind: "not_found",
        sourceKey: payload.command.value.sourceKey,
        type: "record_source_lookup",
      };
    case "recordDescriptorResolved":
      return {
        descriptor: fromSourceApiDescriptorMessage(
          payload.command.value.descriptor
        ),
        kind: "resolved",
        requestDescriptor:
          payload.command.value.requestDescriptor === undefined
            ? null
            : fromSourceApiRequestDescriptorMessage(
                payload.command.value.requestDescriptor
              ),
        type: "record_descriptor_resolution",
      };
    case "recordDescriptorResolutionFailed": {
      return {
        detail: payload.command.value.detail,
        failureCode: fromDescriptorResolutionFailureCode(
          payload.command.value.failureCode
        ),
        kind: "failed",
        type: "record_descriptor_resolution",
      };
    }
    case "recordRequestPrepared":
      return {
        kind: "prepared",
        preparedRequestFingerprint:
          payload.command.value.preparedRequestFingerprint,
        type: "record_request_preparation",
      };
    case "recordRequestPreparationFailed": {
      return {
        detail: payload.command.value.detail,
        failureCode: fromRequestPreparationFailureCode(
          payload.command.value.failureCode
        ),
        kind: "failed",
        type: "record_request_preparation",
      };
    }
    case "recordPageFetchSucceeded":
      return {
        attemptNumber: payload.command.value.attemptNumber,
        contentType: isFieldSet(
          payload.command.value,
          sourceApiPb.SourceApiActionRecordPageFetchSucceededCommandSchema.field
            .contentType
        )
          ? payload.command.value.contentType
          : null,
        executionResult: fromSourceApiExecutionResultMessage(
          payload.command.value.executionResult
        ),
        hasContinuation: payload.command.value.hasContinuation,
        httpStatus: payload.command.value.httpStatus,
        kind: "succeeded",
        pageIndex: payload.command.value.pageIndex,
        responseBytes: isFieldSet(
          payload.command.value,
          sourceApiPb.SourceApiActionRecordPageFetchSucceededCommandSchema.field
            .responseBytes
        )
          ? Number(payload.command.value.responseBytes)
          : null,
        type: "record_page_fetch",
      };
    case "recordPageFetchTerminalFailure": {
      return {
        attemptNumber: payload.command.value.attemptNumber,
        detail: payload.command.value.detail,
        failureCode: fromPageFetchFailureCode(
          payload.command.value.failureCode
        ),
        kind: "terminal_failure",
        pageIndex: payload.command.value.pageIndex,
        type: "record_page_fetch",
      };
    }
    case undefined:
      throw new Error("source api action command payload missing oneof case");
    default:
      return assertNever(payload.command);
  }
}

function getSourceApiActionCommandPayloadTypeFromOneofCase(
  oneofCase: sourceApiPb.SourceApiActionCommandPayload["command"]["case"]
): string {
  switch (oneofCase) {
    case "startDescribe":
      return "start_describe";
    case "startInvoke":
      return "start_invoke";
    case "resumeInvoke":
      return "resume_invoke";
    case "recordSourceFound":
      return "record_source_found";
    case "recordSourceNotFound":
      return "record_source_not_found";
    case "recordDescriptorResolved":
      return "record_descriptor_resolved";
    case "recordDescriptorResolutionFailed":
      return "record_descriptor_resolution_failed";
    case "recordRequestPrepared":
      return "record_request_prepared";
    case "recordRequestPreparationFailed":
      return "record_request_preparation_failed";
    case "recordPageFetchSucceeded":
      return "record_page_fetch_succeeded";
    case "recordPageFetchTerminalFailure":
      return "record_page_fetch_terminal_failure";
    case undefined:
      throw new Error("source api action command payload missing oneof case");
    default:
      return assertNever(oneofCase);
  }
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

function toSourceApiActionEffectMessage(effect: SourceApiActionEffect) {
  switch (effect.type) {
    case "load_source":
      return create(sourceApiPb.SourceApiActionEffectPayloadSchema, {
        effect: {
          case: "loadSource",
          value: create(sourceApiPb.SourceApiActionLoadSourceEffectSchema, {
            organizationId: effect.organizationId,
            sourceKey: effect.sourceKey,
          }),
        },
      });
    case "resolve_descriptor":
      return create(sourceApiPb.SourceApiActionEffectPayloadSchema, {
        effect: {
          case: "resolveDescriptor",
          value: create(
            sourceApiPb.SourceApiActionResolveDescriptorEffectSchema,
            {
              source: toSourceApiSourceDescriptorMessage(effect.source),
            }
          ),
        },
      });
    case "prepare_request":
      return create(sourceApiPb.SourceApiActionEffectPayloadSchema, {
        effect: {
          case: "prepareRequest",
          value: create(sourceApiPb.SourceApiActionPrepareRequestEffectSchema, {
            requestDescriptor: toSourceApiRequestDescriptorMessage(
              effect.requestDescriptor
            ),
            source: toSourceApiSourceDescriptorMessage(effect.source),
          }),
        },
      });
    case "execute_page":
      return create(sourceApiPb.SourceApiActionEffectPayloadSchema, {
        effect: {
          case: "executePage",
          value: create(sourceApiPb.SourceApiActionExecutePageEffectSchema, {
            attemptNumber: effect.attemptNumber,
            pageIndex: effect.pageIndex,
            preparedRequestFingerprint: effect.preparedRequestFingerprint,
            requestDescriptor: toSourceApiRequestDescriptorMessage(
              effect.requestDescriptor
            ),
            source: toSourceApiSourceDescriptorMessage(effect.source),
          }),
        },
      });
    default:
      return assertNever(effect);
  }
}

function fromSourceApiActionEffectMessage(
  payload: sourceApiPb.SourceApiActionEffectPayload
): SourceApiActionEffect {
  switch (payload.effect.case) {
    case "loadSource":
      return {
        organizationId: payload.effect.value.organizationId,
        sourceKey: payload.effect.value.sourceKey,
        type: "load_source",
      };
    case "resolveDescriptor":
      return {
        source: fromSourceApiSourceDescriptorMessage(
          payload.effect.value.source
        ),
        type: "resolve_descriptor",
      };
    case "prepareRequest":
      return {
        requestDescriptor: fromSourceApiRequestDescriptorMessage(
          payload.effect.value.requestDescriptor
        ),
        source: fromSourceApiSourceDescriptorMessage(
          payload.effect.value.source
        ),
        type: "prepare_request",
      };
    case "executePage":
      return {
        attemptNumber: payload.effect.value.attemptNumber,
        pageIndex: payload.effect.value.pageIndex,
        preparedRequestFingerprint:
          payload.effect.value.preparedRequestFingerprint,
        requestDescriptor: fromSourceApiRequestDescriptorMessage(
          payload.effect.value.requestDescriptor
        ),
        source: fromSourceApiSourceDescriptorMessage(
          payload.effect.value.source
        ),
        type: "execute_page",
      };
    case undefined:
      throw new Error("source api action effect payload missing oneof case");
    default:
      return assertNever(payload.effect);
  }
}

function toSourceApiSourceDescriptorMessage(
  source: SourceApiActionSourceDescriptor
) {
  return create(sourceApiPb.SourceApiActionSourceDescriptorSchema, {
    ...(source.displayName === null ? {} : { displayName: source.displayName }),
    provider: toWorkflowSourceProvider(source.provider),
    sourceId: source.sourceId,
    sourceKey: source.sourceKey,
  });
}

function fromSourceApiSourceDescriptorMessage(
  source: sourceApiPb.SourceApiActionSourceDescriptor | undefined
): SourceApiActionSourceDescriptor {
  const value = requireMessage(source, "source");

  return {
    displayName: isFieldSet(
      value,
      sourceApiPb.SourceApiActionSourceDescriptorSchema.field.displayName
    )
      ? value.displayName
      : null,
    provider: fromWorkflowSourceProvider(value.provider),
    sourceId: value.sourceId,
    sourceKey: value.sourceKey,
  };
}

function toSourceApiRequestDescriptorMessage(
  descriptor: SourceApiActionRequestDescriptor
) {
  return create(sourceApiPb.SourceApiActionRequestDescriptorSchema, {
    ...(descriptor.descriptorVersion === null
      ? {}
      : { descriptorVersion: descriptor.descriptorVersion }),
    ...(descriptor.kind === null
      ? {}
      : { kind: toSourceApiOperationKind(descriptor.kind) }),
    ...(descriptor.method === null ? {} : { method: descriptor.method }),
    operation: descriptor.operation,
    ...(descriptor.paginationPolicy === null
      ? {}
      : {
          paginationPolicy: toSourceApiPaginationPolicy(
            descriptor.paginationPolicy
          ),
        }),
    ...(descriptor.selector === null ? {} : { selector: descriptor.selector }),
  });
}

function fromSourceApiRequestDescriptorMessage(
  descriptor: sourceApiPb.SourceApiActionRequestDescriptor | undefined
): SourceApiActionRequestDescriptor {
  const value = requireMessage(descriptor, "request_descriptor");

  return {
    descriptorVersion: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.descriptorVersion
    )
      ? value.descriptorVersion
      : null,
    kind: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.kind
    )
      ? fromSourceApiOperationKind(value.kind)
      : null,
    method: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.method
    )
      ? value.method
      : null,
    operation: value.operation,
    paginationPolicy: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.paginationPolicy
    )
      ? fromSourceApiPaginationPolicy(value.paginationPolicy)
      : null,
    selector: isFieldSet(
      value,
      sourceApiPb.SourceApiActionRequestDescriptorSchema.field.selector
    )
      ? value.selector
      : null,
  };
}

function toSourceApiDescriptorMessage(descriptor: SourceApiDescriptor) {
  return create(sourceApiPb.SourceApiActionDescriptorSchema, {
    ...(descriptor.defaultPathOperation === undefined
      ? {}
      : { defaultPathOperation: descriptor.defaultPathOperation }),
    descriptorVersion: descriptor.descriptorVersion,
    examples: descriptor.examples.map(toSourceApiExampleMessage),
    notes: [...descriptor.notes],
    operations: descriptor.operations.map(toSourceApiOperationMessage),
    source: create(sourceApiPb.SourceApiActionDescriptorSourceSchema, {
      ...(descriptor.source.displayName === undefined ||
      descriptor.source.displayName === null
        ? {}
        : { displayName: descriptor.source.displayName }),
      provider: toWorkflowSourceProvider(descriptor.source.provider),
      sourceKey: descriptor.source.sourceKey,
    }),
  });
}

function fromSourceApiDescriptorMessage(
  descriptor: sourceApiPb.SourceApiActionDescriptor | undefined
): SourceApiDescriptor {
  const value = requireMessage(descriptor, "descriptor");
  const source = requireMessage(value.source, "source");

  return {
    ...(isFieldSet(
      value,
      sourceApiPb.SourceApiActionDescriptorSchema.field.defaultPathOperation
    )
      ? { defaultPathOperation: value.defaultPathOperation }
      : {}),
    descriptorVersion: value.descriptorVersion,
    examples: value.examples.map(fromSourceApiExampleMessage),
    notes: [...value.notes],
    operations: value.operations.map(fromSourceApiOperationMessage),
    source: {
      ...(isFieldSet(
        source,
        sourceApiPb.SourceApiActionDescriptorSourceSchema.field.displayName
      )
        ? { displayName: source.displayName }
        : {}),
      provider: fromWorkflowSourceProvider(source.provider),
      sourceKey: source.sourceKey,
    },
  };
}

function toSourceApiOperationMessage(operation: SourceApiOperation) {
  return create(sourceApiPb.SourceApiActionOperationSchema, {
    description: operation.description,
    examples: operation.examples.map(toSourceApiExampleMessage),
    fieldPolicy: toSourceApiFieldPolicyMessage(operation.fieldPolicy),
    headerPolicy: toSourceApiHeaderPolicyMessage(operation.headerPolicy),
    kind: toSourceApiOperationKind(operation.kind),
    methodPolicy: toSourceApiMethodPolicyMessage(operation.methodPolicy),
    name: operation.name,
    notes: [...operation.notes],
    paginationPolicy: toSourceApiPaginationPolicy(operation.paginationPolicy),
    ...(operation.selectorLabel === undefined
      ? {}
      : { selectorLabel: operation.selectorLabel }),
    selectorKind: toSourceApiSelectorKind(operation.selectorKind),
    summary: operation.summary,
  });
}

function fromSourceApiOperationMessage(
  operation: sourceApiPb.SourceApiActionOperation
): SourceApiOperation {
  return {
    description: operation.description,
    examples: operation.examples.map(fromSourceApiExampleMessage),
    fieldPolicy: fromSourceApiFieldPolicyMessage(operation.fieldPolicy),
    headerPolicy: fromSourceApiHeaderPolicyMessage(operation.headerPolicy),
    kind: fromSourceApiOperationKind(operation.kind),
    methodPolicy: fromSourceApiMethodPolicyMessage(operation.methodPolicy),
    name: operation.name,
    notes: [...operation.notes],
    paginationPolicy: fromSourceApiPaginationPolicy(operation.paginationPolicy),
    ...(isFieldSet(
      operation,
      sourceApiPb.SourceApiActionOperationSchema.field.selectorLabel
    )
      ? { selectorLabel: operation.selectorLabel }
      : {}),
    selectorKind: fromSourceApiSelectorKind(operation.selectorKind),
    summary: operation.summary,
  };
}

function toSourceApiMethodPolicyMessage(policy: SourceApiMethodPolicy) {
  return create(sourceApiPb.SourceApiActionMethodPolicySchema, {
    allowedMethods: [...policy.allowedMethods],
    ...(policy.defaultMethod === undefined
      ? {}
      : { defaultMethod: policy.defaultMethod }),
  });
}

function fromSourceApiMethodPolicyMessage(
  policy: sourceApiPb.SourceApiActionMethodPolicy | undefined
): SourceApiMethodPolicy {
  const value = requireMessage(policy, "method_policy");

  return {
    allowedMethods: [...value.allowedMethods],
    ...(isFieldSet(
      value,
      sourceApiPb.SourceApiActionMethodPolicySchema.field.defaultMethod
    )
      ? { defaultMethod: value.defaultMethod }
      : {}),
  };
}

function toSourceApiFieldPolicyMessage(policy: SourceApiFieldPolicy) {
  return create(sourceApiPb.SourceApiActionFieldPolicySchema, {
    acceptsInput: policy.acceptsInput,
    allowsRawFields: policy.allowsRawFields,
    allowsTypedFields: policy.allowsTypedFields,
    inputMode: toSourceApiInputMode(policy.inputMode),
    mergePatches: policy.mergePatches,
    supportsArrayPaths: policy.supportsArrayPaths,
    supportsNestedPaths: policy.supportsNestedPaths,
  });
}

function fromSourceApiFieldPolicyMessage(
  policy: sourceApiPb.SourceApiActionFieldPolicy | undefined
): SourceApiFieldPolicy {
  const value = requireMessage(policy, "field_policy");

  return {
    acceptsInput: value.acceptsInput,
    allowsRawFields: value.allowsRawFields,
    allowsTypedFields: value.allowsTypedFields,
    inputMode: fromSourceApiInputMode(value.inputMode),
    mergePatches: value.mergePatches,
    supportsArrayPaths: value.supportsArrayPaths,
    supportsNestedPaths: value.supportsNestedPaths,
  };
}

function toSourceApiHeaderPolicyMessage(policy: SourceApiHeaderPolicy) {
  return create(sourceApiPb.SourceApiActionHeaderPolicySchema, {
    allowedRequestHeaderNames: canonicalizeSourceApiHeaderNames(
      policy.allowedRequestHeaders
    ),
    allowedResponseHeaderNames: canonicalizeSourceApiHeaderNames(
      policy.allowedResponseHeaders
    ),
  });
}

function fromSourceApiHeaderPolicyMessage(
  policy: sourceApiPb.SourceApiActionHeaderPolicy | undefined
): SourceApiHeaderPolicy {
  const value = requireMessage(policy, "header_policy");

  return {
    allowedRequestHeaders: [...value.allowedRequestHeaderNames],
    allowedResponseHeaders: [...value.allowedResponseHeaderNames],
  };
}

function toSourceApiExampleMessage(
  example: SourceApiDescriptor["examples"][number]
) {
  return create(sourceApiPb.SourceApiActionExampleSchema, {
    command: example.command,
    ...(example.description === undefined
      ? {}
      : { description: example.description }),
    label: example.label,
  });
}

function fromSourceApiExampleMessage(
  example: sourceApiPb.SourceApiActionExample
) {
  return {
    command: example.command,
    ...(isFieldSet(
      example,
      sourceApiPb.SourceApiActionExampleSchema.field.description
    )
      ? { description: example.description }
      : {}),
    label: example.label,
  };
}

function toSourceApiExecutionResultMessage(
  result: StoredSourceApiExecutionResult
) {
  return create(sourceApiPb.SourceApiActionExecutionResultSchema, {
    body: toSourceApiExecutionBodyMessage(result.body),
    contentType: result.contentType,
    headers: result.headers.map((header) =>
      create(sourceApiPb.WorkflowSourceHeaderSchema, {
        name: header.name,
        value: header.value,
      })
    ),
    ...(result.nextContinuationState === undefined
      ? {}
      : {
          nextContinuationState: fromJson(
            ValueSchema,
            result.nextContinuationState
          ),
        }),
    operation: result.operation,
    ...(result.selector === undefined ? {} : { selector: result.selector }),
    httpStatus: result.status,
    source: toSourceApiExecutionSourceMessage(result.source),
  });
}

function fromSourceApiExecutionResultMessage(
  result: sourceApiPb.SourceApiActionExecutionResult | undefined
): StoredSourceApiExecutionResult {
  const value = requireMessage(result, "execution_result");

  return {
    body: fromSourceApiExecutionBodyMessage(value.body),
    contentType: value.contentType,
    headers: value.headers.map((header) => ({
      name: header.name,
      value: header.value,
    })),
    ...(value.nextContinuationState === undefined
      ? {}
      : {
          nextContinuationState: toJson(
            ValueSchema,
            value.nextContinuationState
          ),
        }),
    operation: value.operation,
    ...(isFieldSet(
      value,
      sourceApiPb.SourceApiActionExecutionResultSchema.field.selector
    )
      ? { selector: value.selector }
      : {}),
    source: fromSourceApiExecutionSourceMessage(value.source),
    status: value.httpStatus,
  };
}

function toSourceApiExecutionSourceMessage(source: SourceApiSource) {
  return create(sourceApiPb.SourceApiActionExecutionSourceSchema, {
    ...(source.displayName === undefined || source.displayName === null
      ? {}
      : { displayName: source.displayName }),
    provider: toWorkflowSourceProvider(source.provider),
    sourceKey: source.sourceKey,
  });
}

function fromSourceApiExecutionSourceMessage(
  source: sourceApiPb.SourceApiActionExecutionSource | undefined
) {
  const value = requireMessage(source, "source");

  return {
    ...(isFieldSet(
      value,
      sourceApiPb.SourceApiActionExecutionSourceSchema.field.displayName
    )
      ? { displayName: value.displayName }
      : {}),
    provider: fromWorkflowSourceProvider(value.provider),
    sourceKey: value.sourceKey,
  };
}

function toSourceApiExecutionBodyMessage(
  body: StoredSourceApiExecutionResult["body"]
): sourceApiPb.SourceApiActionExecutionResult["body"] {
  switch (body.kind) {
    case "none":
      return {
        case: "none",
        value: create(sourceApiPb.SourceApiActionEmptyBodySchema),
      };
    case "json":
      return {
        case: "json",
        value: fromJson(ValueSchema, body.value),
      };
    case "text":
      return {
        case: "text",
        value: body.value,
      };
    case "binary":
      return {
        case: "binary",
        value: body.value,
      };
    default:
      return assertNever(body);
  }
}

function fromSourceApiExecutionBodyMessage(
  body: sourceApiPb.SourceApiActionExecutionResult["body"]
): StoredSourceApiExecutionResult["body"] {
  switch (body.case) {
    case "none":
      return {
        kind: "none",
      };
    case "json":
      return {
        kind: "json",
        value: toJson(ValueSchema, body.value),
      };
    case "text":
      return {
        kind: "text",
        value: body.value,
      };
    case "binary":
      return {
        kind: "binary",
        value: new Uint8Array(body.value),
      };
    case undefined:
      throw new Error("source api execution result body missing oneof case");
    default:
      return assertNever(body);
  }
}

function toWorkflowSourceProvider(provider: ProviderType) {
  switch (provider) {
    case "postgres":
      return commonPb.WorkflowSourceProvider.POSTGRES;
    case "supabase":
      return commonPb.WorkflowSourceProvider.SUPABASE;
    case "mysql":
      return commonPb.WorkflowSourceProvider.MYSQL;
    case "mongodb":
      return commonPb.WorkflowSourceProvider.MONGODB;
    case "bigquery":
      return commonPb.WorkflowSourceProvider.BIGQUERY;
    case "laminar":
      return commonPb.WorkflowSourceProvider.LAMINAR;
    case "aws_athena_connector":
      return commonPb.WorkflowSourceProvider.AWS_ATHENA_CONNECTOR;
    case "ga":
      return commonPb.WorkflowSourceProvider.GOOGLE_ANALYTICS;
    case "amplitude":
      return commonPb.WorkflowSourceProvider.AMPLITUDE;
    case "mixpanel":
      return commonPb.WorkflowSourceProvider.MIXPANEL;
    case "posthog":
      return commonPb.WorkflowSourceProvider.POSTHOG;
    case "sentry":
      return commonPb.WorkflowSourceProvider.SENTRY;
    case "github":
      return commonPb.WorkflowSourceProvider.GITHUB;
    case "linear":
      return commonPb.WorkflowSourceProvider.LINEAR;
    default:
      return assertNever(provider);
  }
}

function fromWorkflowSourceProvider(
  provider: commonPb.WorkflowSourceProvider
): ProviderType {
  switch (provider) {
    case commonPb.WorkflowSourceProvider.POSTGRES:
      return "postgres";
    case commonPb.WorkflowSourceProvider.SUPABASE:
      return "supabase";
    case commonPb.WorkflowSourceProvider.MYSQL:
      return "mysql";
    case commonPb.WorkflowSourceProvider.MONGODB:
      return "mongodb";
    case commonPb.WorkflowSourceProvider.BIGQUERY:
      return "bigquery";
    case commonPb.WorkflowSourceProvider.LAMINAR:
      return "laminar";
    case commonPb.WorkflowSourceProvider.AWS_ATHENA_CONNECTOR:
      return "aws_athena_connector";
    case commonPb.WorkflowSourceProvider.GOOGLE_ANALYTICS:
      return "ga";
    case commonPb.WorkflowSourceProvider.AMPLITUDE:
      return "amplitude";
    case commonPb.WorkflowSourceProvider.MIXPANEL:
      return "mixpanel";
    case commonPb.WorkflowSourceProvider.POSTHOG:
      return "posthog";
    case commonPb.WorkflowSourceProvider.SENTRY:
      return "sentry";
    case commonPb.WorkflowSourceProvider.GITHUB:
      return "github";
    case commonPb.WorkflowSourceProvider.LINEAR:
      return "linear";
    case commonPb.WorkflowSourceProvider.UNSPECIFIED:
      throw new Error("workflow source provider is unspecified");
    default:
      throw new Error(`unsupported workflow source provider: ${provider}`);
  }
}

function toSourceApiRequestKind(kind: SourceApiActionRequestKind) {
  switch (kind) {
    case "describe":
      return sourceApiPb.SourceApiActionRequestKind.DESCRIBE;
    case "invoke":
      return sourceApiPb.SourceApiActionRequestKind.INVOKE;
    default:
      return assertNever(kind);
  }
}

function fromSourceApiRequestKind(
  kind: sourceApiPb.SourceApiActionRequestKind
): SourceApiActionRequestKind {
  switch (kind) {
    case sourceApiPb.SourceApiActionRequestKind.DESCRIBE:
      return "describe";
    case sourceApiPb.SourceApiActionRequestKind.INVOKE:
      return "invoke";
    case sourceApiPb.SourceApiActionRequestKind.UNSPECIFIED:
      throw new Error("source api request kind is unspecified");
    default:
      throw new Error(`unsupported source api request kind: ${kind}`);
  }
}

function toSourceApiInvokeMode(mode: SourceApiActionInvokeMode) {
  switch (mode) {
    case "preview_only":
      return sourceApiPb.SourceApiActionInvokeMode.PREVIEW_ONLY;
    case "execute":
      return sourceApiPb.SourceApiActionInvokeMode.EXECUTE;
    default:
      return assertNever(mode);
  }
}

function fromSourceApiInvokeMode(
  mode: sourceApiPb.SourceApiActionInvokeMode
): SourceApiActionInvokeMode {
  switch (mode) {
    case sourceApiPb.SourceApiActionInvokeMode.PREVIEW_ONLY:
      return "preview_only";
    case sourceApiPb.SourceApiActionInvokeMode.EXECUTE:
      return "execute";
    case sourceApiPb.SourceApiActionInvokeMode.UNSPECIFIED:
      throw new Error("source api invoke mode is unspecified");
    default:
      throw new Error(`unsupported source api invoke mode: ${mode}`);
  }
}

function toSourceApiOperationKind(kind: SourceApiOperationKind) {
  switch (kind) {
    case "http_request":
      return sourceApiPb.SourceApiActionOperationKind.HTTP_REQUEST;
    case "structured_request":
      return sourceApiPb.SourceApiActionOperationKind.STRUCTURED_REQUEST;
    default:
      return assertNever(kind);
  }
}

function fromSourceApiOperationKind(
  kind: sourceApiPb.SourceApiActionOperationKind
): SourceApiOperationKind {
  switch (kind) {
    case sourceApiPb.SourceApiActionOperationKind.HTTP_REQUEST:
      return "http_request";
    case sourceApiPb.SourceApiActionOperationKind.STRUCTURED_REQUEST:
      return "structured_request";
    case sourceApiPb.SourceApiActionOperationKind.UNSPECIFIED:
      throw new Error("source api operation kind is unspecified");
    default:
      throw new Error(`unsupported source api operation kind: ${kind}`);
  }
}

function toSourceApiSelectorKind(kind: SourceApiSelectorKind) {
  switch (kind) {
    case "none":
      return sourceApiPb.SourceApiActionSelectorKind.NONE;
    case "path":
      return sourceApiPb.SourceApiActionSelectorKind.PATH;
    case "identifier":
      return sourceApiPb.SourceApiActionSelectorKind.IDENTIFIER;
    default:
      return assertNever(kind);
  }
}

function fromSourceApiSelectorKind(
  kind: sourceApiPb.SourceApiActionSelectorKind
): SourceApiSelectorKind {
  switch (kind) {
    case sourceApiPb.SourceApiActionSelectorKind.NONE:
      return "none";
    case sourceApiPb.SourceApiActionSelectorKind.PATH:
      return "path";
    case sourceApiPb.SourceApiActionSelectorKind.IDENTIFIER:
      return "identifier";
    case sourceApiPb.SourceApiActionSelectorKind.UNSPECIFIED:
      throw new Error("source api selector kind is unspecified");
    default:
      throw new Error(`unsupported source api selector kind: ${kind}`);
  }
}

function toSourceApiPaginationPolicy(policy: SourceApiPaginationPolicy) {
  switch (policy) {
    case "none":
      return sourceApiPb.SourceApiActionPaginationPolicy.NONE;
    case "continuation_token":
      return sourceApiPb.SourceApiActionPaginationPolicy.CONTINUATION_TOKEN;
    default:
      return assertNever(policy);
  }
}

function fromSourceApiPaginationPolicy(
  policy: sourceApiPb.SourceApiActionPaginationPolicy
): SourceApiPaginationPolicy {
  switch (policy) {
    case sourceApiPb.SourceApiActionPaginationPolicy.NONE:
      return "none";
    case sourceApiPb.SourceApiActionPaginationPolicy.CONTINUATION_TOKEN:
      return "continuation_token";
    case sourceApiPb.SourceApiActionPaginationPolicy.UNSPECIFIED:
      throw new Error("source api pagination policy is unspecified");
    default:
      throw new Error(`unsupported source api pagination policy: ${policy}`);
  }
}

function toSourceApiInputMode(mode: SourceApiFieldPolicy["inputMode"]) {
  switch (mode) {
    case "none":
      return sourceApiPb.SourceApiActionInputMode.NONE;
    case "request_object":
      return sourceApiPb.SourceApiActionInputMode.REQUEST_OBJECT;
    case "request_body":
      return sourceApiPb.SourceApiActionInputMode.REQUEST_BODY;
    default:
      return assertNever(mode);
  }
}

function fromSourceApiInputMode(
  mode: sourceApiPb.SourceApiActionInputMode
): SourceApiFieldPolicy["inputMode"] {
  switch (mode) {
    case sourceApiPb.SourceApiActionInputMode.NONE:
      return "none";
    case sourceApiPb.SourceApiActionInputMode.REQUEST_OBJECT:
      return "request_object";
    case sourceApiPb.SourceApiActionInputMode.REQUEST_BODY:
      return "request_body";
    case sourceApiPb.SourceApiActionInputMode.UNSPECIFIED:
      throw new Error("source api input mode is unspecified");
    default:
      throw new Error(`unsupported source api input mode: ${mode}`);
  }
}

function toSourceApiFailureCode(code: SourceApiActionFailureCode) {
  switch (code) {
    case "source_not_found":
      return sourceApiPb.SourceApiActionFailureCode.SOURCE_NOT_FOUND;
    case "descriptor_unavailable":
      return sourceApiPb.SourceApiActionFailureCode.DESCRIPTOR_UNAVAILABLE;
    case "invalid_request":
      return sourceApiPb.SourceApiActionFailureCode.INVALID_REQUEST;
    case "permission_denied":
      return sourceApiPb.SourceApiActionFailureCode.PERMISSION_DENIED;
    case "request_timed_out":
      return sourceApiPb.SourceApiActionFailureCode.REQUEST_TIMED_OUT;
    case "execution_failed":
      return sourceApiPb.SourceApiActionFailureCode.EXECUTION_FAILED;
    case "execution_state_invalid":
      return sourceApiPb.SourceApiActionFailureCode.EXECUTION_STATE_INVALID;
    default:
      return assertNever(code);
  }
}

function fromDescriptorResolutionFailureCode(
  code: sourceApiPb.SourceApiActionFailureCode
): Extract<
  SourceApiActionFailureCode,
  "descriptor_unavailable" | "permission_denied"
> {
  switch (code) {
    case sourceApiPb.SourceApiActionFailureCode.DESCRIPTOR_UNAVAILABLE:
      return "descriptor_unavailable";
    case sourceApiPb.SourceApiActionFailureCode.PERMISSION_DENIED:
      return "permission_denied";
    case sourceApiPb.SourceApiActionFailureCode.UNSPECIFIED:
      throw new Error("source api failure code is unspecified");
    default:
      throw new Error(
        `unsupported descriptor resolution failure code: ${code}`
      );
  }
}

function fromRequestPreparationFailureCode(
  code: sourceApiPb.SourceApiActionFailureCode
): Extract<
  SourceApiActionFailureCode,
  "invalid_request" | "permission_denied" | "execution_state_invalid"
> {
  switch (code) {
    case sourceApiPb.SourceApiActionFailureCode.INVALID_REQUEST:
      return "invalid_request";
    case sourceApiPb.SourceApiActionFailureCode.PERMISSION_DENIED:
      return "permission_denied";
    case sourceApiPb.SourceApiActionFailureCode.EXECUTION_STATE_INVALID:
      return "execution_state_invalid";
    case sourceApiPb.SourceApiActionFailureCode.UNSPECIFIED:
      throw new Error("source api failure code is unspecified");
    default:
      throw new Error(`unsupported request preparation failure code: ${code}`);
  }
}

function fromPageFetchFailureCode(
  code: sourceApiPb.SourceApiActionFailureCode
): Extract<
  SourceApiActionFailureCode,
  | "invalid_request"
  | "request_timed_out"
  | "execution_failed"
  | "execution_state_invalid"
> {
  switch (code) {
    case sourceApiPb.SourceApiActionFailureCode.INVALID_REQUEST:
      return "invalid_request";
    case sourceApiPb.SourceApiActionFailureCode.REQUEST_TIMED_OUT:
      return "request_timed_out";
    case sourceApiPb.SourceApiActionFailureCode.EXECUTION_FAILED:
      return "execution_failed";
    case sourceApiPb.SourceApiActionFailureCode.EXECUTION_STATE_INVALID:
      return "execution_state_invalid";
    case sourceApiPb.SourceApiActionFailureCode.UNSPECIFIED:
      throw new Error("source api failure code is unspecified");
    default:
      throw new Error(`unsupported page fetch failure code: ${code}`);
  }
}

function assertMatchingPayloadType(expected: string, actual: string) {
  if (expected !== actual) {
    throw new Error(
      `stored scalar payload type '${expected}' does not match protobuf payload type '${actual}'`
    );
  }
}

function requireMessage<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined) {
    throw new Error(`missing required protobuf field: ${fieldName}`);
  }

  return value;
}
