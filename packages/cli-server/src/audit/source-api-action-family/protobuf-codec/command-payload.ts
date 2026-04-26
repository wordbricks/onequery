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
import type { SourceApiActionCommandPayload } from "../commands";
import {
  fromDescriptorResolutionFailureCode,
  fromPageFetchFailureCode,
  fromRequestPreparationFailureCode,
  fromSourceApiInvokeMode,
  toSourceApiFailureCode,
  toSourceApiInvokeMode,
} from "./enums";
import { assertMatchingPayloadType } from "./shared";
import type { SourceApiPayloadDecodeContext } from "./shared";
import {
  fromSourceApiDescriptorMessage,
  fromSourceApiExecutionResultMessage,
  fromSourceApiRequestDescriptorMessage,
  fromSourceApiSourceDescriptorMessage,
  toSourceApiDescriptorMessage,
  toSourceApiExecutionResultMessage,
  toSourceApiRequestDescriptorMessage,
  toSourceApiSourceDescriptorMessage,
} from "./source-api-value-codec";

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
