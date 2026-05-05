import { create, isFieldSet } from "@bufbuild/protobuf";
import { durationFromMs, durationMs } from "@bufbuild/protobuf/wkt";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";
import {
  WorkflowDataSourceStatus,
  WorkflowSourceProvider,
} from "@onequery/proto-workflow/workflow/v1/common_pb";
import {
  QueryActionCommandPayloadSchema,
  QueryActionCredentialsLoadedEventSchema,
  QueryActionEffectPayloadSchema,
  QueryActionEventPayloadSchema,
  QueryActionExecuteQueryEffectSchema,
  QueryActionMode as ProtoQueryActionMode,
  QueryActionPrepareExecuteQueryEffectSchema,
  QueryActionPrepareValidateQueryEffectSchema,
  QueryActionPersistUsageEffectSchema,
  QueryActionQueryColumnSchema,
  QueryActionQueryExecutedEventSchema,
  QueryActionQueryExecutionFailedEventSchema,
  QueryActionQueryLogicalType as ProtoQueryLogicalType,
  QueryActionQueryPreparationFailedEventSchema,
  QueryActionQueryRejectedEventSchema,
  QueryActionQueryRowSchema,
  QueryActionQuerySourceRecordSchema,
  QueryActionQueryTimedOutEventSchema,
  QueryActionQueryUnavailableEventSchema,
  QueryActionQueryValidatedEventSchema,
  QueryActionReceivedEventSchema,
  QueryActionRecordExecutePreparationFailedCommandSchema,
  QueryActionRecordExecutePreparationQueryInterfaceMissingCommandSchema,
  QueryActionRecordExecutePreparationRejectedCommandSchema,
  QueryActionRecordExecutePreparationSourceNotFoundCommandSchema,
  QueryActionRecordExecutePreparationSucceededCommandSchema,
  QueryActionRecordQueryExecutionFailedCommandSchema,
  QueryActionRecordQueryExecutionResultSchema,
  QueryActionRecordQueryExecutionSucceededCommandSchema,
  QueryActionRecordQueryExecutionTimedOutCommandSchema,
  QueryActionRecordQueryExecutionUnavailableCommandSchema,
  QueryActionRecordUsagePersistenceFailedCommandSchema,
  QueryActionRecordUsagePersistenceSucceededCommandSchema,
  QueryActionRecordValidatePreparationAcceptedCommandSchema,
  QueryActionRecordValidatePreparationFailedCommandSchema,
  QueryActionRecordValidatePreparationQueryInterfaceMissingCommandSchema,
  QueryActionRecordValidatePreparationRejectedCommandSchema,
  QueryActionRecordValidatePreparationSourceNotFoundCommandSchema,
  QueryActionSourceDescriptorSchema,
  QueryActionSourceLoadedEventSchema,
  QueryActionSourceNotFoundEventSchema,
  QueryActionSourceQueryInterfaceMissingEventSchema,
  QueryActionStartExecuteCommandSchema,
  QueryActionStartValidateCommandSchema,
  QueryActionUsagePersistedEventSchema,
  QueryActionUsagePersistFailedEventSchema,
} from "@onequery/proto-workflow/workflow/v1/query_action_pb";
import type {
  QueryActionCommandPayload as ProtoQueryActionCommandPayload,
  QueryActionEffectPayload as ProtoQueryActionEffectPayload,
  QueryActionEventPayload as ProtoQueryActionEventPayload,
  QueryActionQueryColumn as ProtoQueryActionQueryColumn,
  QueryActionQuerySourceRecord as ProtoQueryActionQuerySourceRecord,
  QueryActionRecordQueryExecutionResult as ProtoQueryExecutionResult,
  QueryActionSourceDescriptor as ProtoQueryActionSourceDescriptor,
} from "@onequery/proto-workflow/workflow/v1/query_action_pb";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import type { CliQuerySuccessResult } from "../../domain/workflows";
import { WorkflowStorageCorruptRowError } from "../storage/errors";
import {
  assertNever,
  convertWorkflowPayload,
  decodeWorkflowPayload,
  encodeWorkflowPayload,
} from "../storage/protobuf-codec";
import type { WorkflowPayloadCodecContext } from "../storage/protobuf-codec";
import type { QueryActionCommandPayload } from "./commands";
import type {
  QueryActionMode,
  QueryActionSourceDescriptor,
} from "./descriptors";
import type { QueryActionEffect } from "./effects";
import type { QueryActionEvent } from "./events";

type QueryPayloadDecodeContext = Omit<
  WorkflowPayloadCodecContext,
  "entity" | "family" | "payloadType"
> & {
  payloadType: string;
};

export function encodeQueryActionCommandPayload(
  payload: QueryActionCommandPayload
): Buffer {
  return encodeWorkflowPayload(
    QueryActionCommandPayloadSchema,
    toQueryActionCommandMessage(payload)
  );
}

export function getQueryActionCommandPayloadType(
  payload: QueryActionCommandPayload
): string {
  switch (payload.type) {
    case "start_validate":
      return "start_validate";
    case "start_execute":
      return "start_execute";
    case "record_validate_preparation":
      switch (payload.kind) {
        case "accepted":
          return "record_validate_preparation_accepted";
        case "rejected":
          return "record_validate_preparation_rejected";
        case "not_found":
          return "record_validate_preparation_source_not_found";
        case "query_interface_missing":
          return "record_validate_preparation_query_interface_missing";
        case "failed":
          return "record_validate_preparation_failed";
        default:
          return assertNever(payload);
      }
    case "record_execute_preparation":
      switch (payload.kind) {
        case "succeeded":
          return "record_execute_preparation_succeeded";
        case "rejected":
          return "record_execute_preparation_rejected";
        case "not_found":
          return "record_execute_preparation_source_not_found";
        case "query_interface_missing":
          return "record_execute_preparation_query_interface_missing";
        case "failed":
          return "record_execute_preparation_failed";
        default:
          return assertNever(payload);
      }
    case "record_query_execution":
      switch (payload.kind) {
        case "succeeded":
          return "record_query_execution_succeeded";
        case "unavailable":
          return "record_query_execution_unavailable";
        case "timed_out":
          return "record_query_execution_timed_out";
        case "failed":
          return "record_query_execution_failed";
        default:
          return assertNever(payload);
      }
    case "record_usage_persistence":
      switch (payload.kind) {
        case "succeeded":
          return "record_usage_persistence_succeeded";
        case "failed":
          return "record_usage_persistence_failed";
        default:
          return assertNever(payload);
      }
    default:
      return assertNever(payload);
  }
}

export function decodeQueryActionCommandPayload(
  bytes: Buffer,
  context: QueryPayloadDecodeContext
): ResultType<QueryActionCommandPayload, WorkflowStorageCorruptRowError> {
  const decoded = decodeWorkflowPayload(
    QueryActionCommandPayloadSchema,
    bytes,
    {
      ...context,
      entity: "query_action_command_payload",
      family: "query_action",
    }
  );
  if (decoded.isErr()) {
    return Result.err(decoded.error);
  }

  return convertWorkflowPayload(
    {
      ...context,
      entity: "query_action_command_payload",
      family: "query_action",
    },
    () => {
      const payloadType = getQueryActionCommandPayloadTypeFromOneofCase(
        decoded.value.command.case
      );
      assertMatchingPayloadType(context.payloadType, payloadType);
      const payload = fromQueryActionCommandMessage(decoded.value);
      return payload;
    }
  );
}

export function encodeQueryActionEventPayload(event: QueryActionEvent): Buffer {
  return encodeWorkflowPayload(
    QueryActionEventPayloadSchema,
    toQueryActionEventMessage(event)
  );
}

export function decodeQueryActionEventPayload(
  bytes: Buffer,
  context: QueryPayloadDecodeContext
): ResultType<QueryActionEvent, WorkflowStorageCorruptRowError> {
  const decoded = decodeWorkflowPayload(QueryActionEventPayloadSchema, bytes, {
    ...context,
    entity: "query_action_event_payload",
    family: "query_action",
  });
  if (decoded.isErr()) {
    return Result.err(decoded.error);
  }

  return convertWorkflowPayload(
    {
      ...context,
      entity: "query_action_event_payload",
      family: "query_action",
    },
    () => {
      const event = fromQueryActionEventMessage(decoded.value);
      assertMatchingPayloadType(context.payloadType, event.type);
      return event;
    }
  );
}

export function encodeQueryActionEffectPayload(
  effect: QueryActionEffect
): Buffer {
  return encodeWorkflowPayload(
    QueryActionEffectPayloadSchema,
    toQueryActionEffectMessage(effect)
  );
}

export function decodeQueryActionEffectPayload(
  bytes: Buffer,
  context: QueryPayloadDecodeContext
): ResultType<QueryActionEffect, WorkflowStorageCorruptRowError> {
  const decoded = decodeWorkflowPayload(QueryActionEffectPayloadSchema, bytes, {
    ...context,
    entity: "query_action_effect_payload",
    family: "query_action",
  });
  if (decoded.isErr()) {
    return Result.err(decoded.error);
  }

  return convertWorkflowPayload(
    {
      ...context,
      entity: "query_action_effect_payload",
      family: "query_action",
    },
    () => {
      const effect = fromQueryActionEffectMessage(decoded.value);
      assertMatchingPayloadType(context.payloadType, effect.type);
      return effect;
    }
  );
}

function toQueryActionCommandMessage(payload: QueryActionCommandPayload) {
  switch (payload.type) {
    case "start_validate":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "startValidate",
          value: create(QueryActionStartValidateCommandSchema, {
            queryText: payload.queryText,
            sourceKey: payload.sourceKey,
          }),
        },
      });
    case "start_execute":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "startExecute",
          value: create(QueryActionStartExecuteCommandSchema, {
            queryText: payload.queryText,
            sourceKey: payload.sourceKey,
          }),
        },
      });
    case "record_validate_preparation":
      return toQueryActionValidatePreparationCommandMessage(payload);
    case "record_execute_preparation":
      return toQueryActionExecutePreparationCommandMessage(payload);
    case "record_query_execution":
      return toQueryActionQueryExecutionCommandMessage(payload);
    case "record_usage_persistence":
      return toQueryActionUsagePersistenceCommandMessage(payload);
    default:
      return assertNever(payload);
  }
}

function toQueryActionValidatePreparationCommandMessage(
  payload: Extract<
    QueryActionCommandPayload,
    { type: "record_validate_preparation" }
  >
) {
  switch (payload.kind) {
    case "accepted":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordValidatePreparationAccepted",
          value: create(
            QueryActionRecordValidatePreparationAcceptedCommandSchema,
            {
              source: toQueryActionSourceDescriptorMessage(payload.source),
              truncated: payload.truncated,
              validatedQuery: payload.validatedQuery,
            }
          ),
        },
      });
    case "rejected":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordValidatePreparationRejected",
          value: create(
            QueryActionRecordValidatePreparationRejectedCommandSchema,
            {
              detail: payload.detail,
              source: toQueryActionSourceDescriptorMessage(payload.source),
            }
          ),
        },
      });
    case "not_found":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordValidatePreparationSourceNotFound",
          value: create(
            QueryActionRecordValidatePreparationSourceNotFoundCommandSchema,
            {
              sourceKey: payload.sourceKey,
            }
          ),
        },
      });
    case "query_interface_missing":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordValidatePreparationQueryInterfaceMissing",
          value: create(
            QueryActionRecordValidatePreparationQueryInterfaceMissingCommandSchema,
            {
              provider: toWorkflowSourceProvider(payload.provider),
              sourceStatus: toWorkflowDataSourceStatus(payload.sourceStatus),
            }
          ),
        },
      });
    case "failed":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordValidatePreparationFailed",
          value: create(
            QueryActionRecordValidatePreparationFailedCommandSchema,
            {
              detail: payload.detail,
              hint: payload.hint,
              ...(payload.source === undefined
                ? {}
                : {
                    source: toQueryActionSourceDescriptorMessage(
                      payload.source
                    ),
                  }),
            }
          ),
        },
      });
    default:
      return assertNever(payload);
  }
}

function toQueryActionExecutePreparationCommandMessage(
  payload: Extract<
    QueryActionCommandPayload,
    { type: "record_execute_preparation" }
  >
) {
  switch (payload.kind) {
    case "succeeded":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordExecutePreparationSucceeded",
          value: create(
            QueryActionRecordExecutePreparationSucceededCommandSchema,
            {
              source: toQueryActionSourceDescriptorMessage(payload.source),
              truncated: payload.truncated,
              validatedQuery: payload.validatedQuery,
            }
          ),
        },
      });
    case "rejected":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordExecutePreparationRejected",
          value: create(
            QueryActionRecordExecutePreparationRejectedCommandSchema,
            {
              detail: payload.detail,
              source: toQueryActionSourceDescriptorMessage(payload.source),
            }
          ),
        },
      });
    case "not_found":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordExecutePreparationSourceNotFound",
          value: create(
            QueryActionRecordExecutePreparationSourceNotFoundCommandSchema,
            {
              sourceKey: payload.sourceKey,
            }
          ),
        },
      });
    case "query_interface_missing":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordExecutePreparationQueryInterfaceMissing",
          value: create(
            QueryActionRecordExecutePreparationQueryInterfaceMissingCommandSchema,
            {
              provider: toWorkflowSourceProvider(payload.provider),
              sourceStatus: toWorkflowDataSourceStatus(payload.sourceStatus),
            }
          ),
        },
      });
    case "failed":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordExecutePreparationFailed",
          value: create(
            QueryActionRecordExecutePreparationFailedCommandSchema,
            {
              detail: payload.detail,
              hint: payload.hint,
              ...(payload.source === undefined
                ? {}
                : {
                    source: toQueryActionSourceDescriptorMessage(
                      payload.source
                    ),
                  }),
            }
          ),
        },
      });
    default:
      return assertNever(payload);
  }
}

function toQueryActionQueryExecutionCommandMessage(
  payload: Extract<
    QueryActionCommandPayload,
    { type: "record_query_execution" }
  >
) {
  switch (payload.kind) {
    case "succeeded":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordQueryExecutionSucceeded",
          value: create(QueryActionRecordQueryExecutionSucceededCommandSchema, {
            response: toQueryExecutionResultMessage(payload.response),
          }),
        },
      });
    case "unavailable":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordQueryExecutionUnavailable",
          value: create(
            QueryActionRecordQueryExecutionUnavailableCommandSchema,
            {
              detail: payload.detail,
            }
          ),
        },
      });
    case "timed_out":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordQueryExecutionTimedOut",
          value: create(QueryActionRecordQueryExecutionTimedOutCommandSchema, {
            detail: payload.detail,
          }),
        },
      });
    case "failed":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordQueryExecutionFailed",
          value: create(QueryActionRecordQueryExecutionFailedCommandSchema, {
            detail: payload.detail,
          }),
        },
      });
    default:
      return assertNever(payload);
  }
}

function toQueryActionUsagePersistenceCommandMessage(
  payload: Extract<
    QueryActionCommandPayload,
    { type: "record_usage_persistence" }
  >
) {
  switch (payload.kind) {
    case "succeeded":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordUsagePersistenceSucceeded",
          value: create(
            QueryActionRecordUsagePersistenceSucceededCommandSchema
          ),
        },
      });
    case "failed":
      return create(QueryActionCommandPayloadSchema, {
        command: {
          case: "recordUsagePersistenceFailed",
          value: create(QueryActionRecordUsagePersistenceFailedCommandSchema, {
            detail: payload.detail,
          }),
        },
      });
    default:
      return assertNever(payload);
  }
}

function fromQueryActionCommandMessage(
  payload: ProtoQueryActionCommandPayload
): QueryActionCommandPayload {
  switch (payload.command.case) {
    case "startValidate":
      return {
        queryText: payload.command.value.queryText,
        sourceKey: payload.command.value.sourceKey,
        type: "start_validate",
      };
    case "startExecute":
      return {
        queryText: payload.command.value.queryText,
        sourceKey: payload.command.value.sourceKey,
        type: "start_execute",
      };
    case "recordValidatePreparationAccepted":
      return {
        kind: "accepted",
        source: fromQueryActionSourceDescriptorMessage(
          payload.command.value.source
        ),
        truncated: payload.command.value.truncated,
        type: "record_validate_preparation",
        validatedQuery: payload.command.value.validatedQuery,
      };
    case "recordValidatePreparationRejected":
      return {
        detail: payload.command.value.detail,
        kind: "rejected",
        source: fromQueryActionSourceDescriptorMessage(
          payload.command.value.source
        ),
        type: "record_validate_preparation",
      };
    case "recordValidatePreparationFailed":
      return {
        detail: payload.command.value.detail,
        hint: payload.command.value.hint,
        kind: "failed",
        ...(payload.command.value.source === undefined
          ? {}
          : {
              source: fromQueryActionSourceDescriptorMessage(
                payload.command.value.source
              ),
            }),
        type: "record_validate_preparation",
      };
    case "recordValidatePreparationSourceNotFound":
      return {
        kind: "not_found",
        sourceKey: payload.command.value.sourceKey,
        type: "record_validate_preparation",
      };
    case "recordValidatePreparationQueryInterfaceMissing":
      return {
        kind: "query_interface_missing",
        provider: fromWorkflowSourceProvider(payload.command.value.provider),
        sourceStatus: fromWorkflowDataSourceStatus(
          payload.command.value.sourceStatus
        ),
        type: "record_validate_preparation",
      };
    case "recordExecutePreparationSucceeded":
      return {
        kind: "succeeded",
        source: fromQueryActionSourceDescriptorMessage(
          payload.command.value.source
        ),
        truncated: payload.command.value.truncated,
        type: "record_execute_preparation",
        validatedQuery: payload.command.value.validatedQuery,
      };
    case "recordExecutePreparationRejected":
      return {
        detail: payload.command.value.detail,
        kind: "rejected",
        source: fromQueryActionSourceDescriptorMessage(
          payload.command.value.source
        ),
        type: "record_execute_preparation",
      };
    case "recordExecutePreparationFailed":
      return {
        detail: payload.command.value.detail,
        hint: payload.command.value.hint,
        kind: "failed",
        ...(payload.command.value.source === undefined
          ? {}
          : {
              source: fromQueryActionSourceDescriptorMessage(
                payload.command.value.source
              ),
            }),
        type: "record_execute_preparation",
      };
    case "recordExecutePreparationSourceNotFound":
      return {
        kind: "not_found",
        sourceKey: payload.command.value.sourceKey,
        type: "record_execute_preparation",
      };
    case "recordExecutePreparationQueryInterfaceMissing":
      return {
        kind: "query_interface_missing",
        provider: fromWorkflowSourceProvider(payload.command.value.provider),
        sourceStatus: fromWorkflowDataSourceStatus(
          payload.command.value.sourceStatus
        ),
        type: "record_execute_preparation",
      };
    case "recordQueryExecutionSucceeded":
      return {
        kind: "succeeded",
        response: fromQueryExecutionResultMessage(
          payload.command.value.response
        ),
        type: "record_query_execution",
      };
    case "recordQueryExecutionUnavailable":
      return {
        detail: payload.command.value.detail,
        kind: "unavailable",
        type: "record_query_execution",
      };
    case "recordQueryExecutionTimedOut":
      return {
        detail: payload.command.value.detail,
        kind: "timed_out",
        type: "record_query_execution",
      };
    case "recordQueryExecutionFailed":
      return {
        detail: payload.command.value.detail,
        kind: "failed",
        type: "record_query_execution",
      };
    case "recordUsagePersistenceSucceeded":
      return {
        kind: "succeeded",
        type: "record_usage_persistence",
      };
    case "recordUsagePersistenceFailed":
      return {
        detail: payload.command.value.detail,
        kind: "failed",
        type: "record_usage_persistence",
      };
    case undefined:
      throw new Error("query action command payload missing oneof case");
    default:
      return assertNever(payload.command);
  }
}

function getQueryActionCommandPayloadTypeFromOneofCase(
  oneofCase: ProtoQueryActionCommandPayload["command"]["case"]
): string {
  switch (oneofCase) {
    case "startValidate":
      return "start_validate";
    case "startExecute":
      return "start_execute";
    case "recordValidatePreparationAccepted":
      return "record_validate_preparation_accepted";
    case "recordValidatePreparationRejected":
      return "record_validate_preparation_rejected";
    case "recordValidatePreparationFailed":
      return "record_validate_preparation_failed";
    case "recordValidatePreparationSourceNotFound":
      return "record_validate_preparation_source_not_found";
    case "recordValidatePreparationQueryInterfaceMissing":
      return "record_validate_preparation_query_interface_missing";
    case "recordExecutePreparationSucceeded":
      return "record_execute_preparation_succeeded";
    case "recordExecutePreparationRejected":
      return "record_execute_preparation_rejected";
    case "recordExecutePreparationFailed":
      return "record_execute_preparation_failed";
    case "recordExecutePreparationSourceNotFound":
      return "record_execute_preparation_source_not_found";
    case "recordExecutePreparationQueryInterfaceMissing":
      return "record_execute_preparation_query_interface_missing";
    case "recordQueryExecutionSucceeded":
      return "record_query_execution_succeeded";
    case "recordQueryExecutionUnavailable":
      return "record_query_execution_unavailable";
    case "recordQueryExecutionTimedOut":
      return "record_query_execution_timed_out";
    case "recordQueryExecutionFailed":
      return "record_query_execution_failed";
    case "recordUsagePersistenceSucceeded":
      return "record_usage_persistence_succeeded";
    case "recordUsagePersistenceFailed":
      return "record_usage_persistence_failed";
    case undefined:
      throw new Error("query action command payload missing oneof case");
    default:
      return assertNever(oneofCase);
  }
}

function toQueryActionEventMessage(event: QueryActionEvent) {
  switch (event.type) {
    case "action_received":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "actionReceived",
          value: create(QueryActionReceivedEventSchema, {
            queryMode: toQueryActionMode(event.queryMode),
            queryText: event.queryText,
          }),
        },
      });
    case "source_loaded":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "sourceLoaded",
          value: create(QueryActionSourceLoadedEventSchema, {
            source: toQueryActionSourceDescriptorMessage(event.source),
          }),
        },
      });
    case "source_not_found":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "sourceNotFound",
          value: create(QueryActionSourceNotFoundEventSchema, {
            sourceKey: event.sourceKey,
          }),
        },
      });
    case "source_query_interface_missing":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "sourceQueryInterfaceMissing",
          value: create(QueryActionSourceQueryInterfaceMissingEventSchema, {
            provider: toWorkflowSourceProvider(event.provider),
            sourceStatus: toWorkflowDataSourceStatus(event.sourceStatus),
          }),
        },
      });
    case "query_validated":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "queryValidated",
          value: create(QueryActionQueryValidatedEventSchema, {
            validatedQuery: event.validatedQuery,
          }),
        },
      });
    case "query_rejected":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "queryRejected",
          value: create(QueryActionQueryRejectedEventSchema, {
            detail: event.detail,
          }),
        },
      });
    case "credentials_loaded":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "credentialsLoaded",
          value: create(QueryActionCredentialsLoadedEventSchema),
        },
      });
    case "query_preparation_failed":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "queryPreparationFailed",
          value: create(QueryActionQueryPreparationFailedEventSchema, {
            detail: event.detail,
            hint: event.hint,
          }),
        },
      });
    case "query_executed":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "queryExecuted",
          value: create(QueryActionQueryExecutedEventSchema, {
            elapsed: durationFromMs(event.elapsedMs),
            rowCount: event.rowCount,
          }),
        },
      });
    case "query_unavailable":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "queryUnavailable",
          value: create(QueryActionQueryUnavailableEventSchema, {
            detail: event.detail,
          }),
        },
      });
    case "query_timed_out":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "queryTimedOut",
          value: create(QueryActionQueryTimedOutEventSchema, {
            detail: event.detail,
          }),
        },
      });
    case "query_execution_failed":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "queryExecutionFailed",
          value: create(QueryActionQueryExecutionFailedEventSchema, {
            detail: event.detail,
          }),
        },
      });
    case "usage_persisted":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "usagePersisted",
          value: create(QueryActionUsagePersistedEventSchema),
        },
      });
    case "usage_persist_failed":
      return create(QueryActionEventPayloadSchema, {
        event: {
          case: "usagePersistFailed",
          value: create(QueryActionUsagePersistFailedEventSchema, {
            detail: event.detail,
          }),
        },
      });
    default:
      return assertNever(event);
  }
}

function fromQueryActionEventMessage(
  payload: ProtoQueryActionEventPayload
): QueryActionEvent {
  switch (payload.event.case) {
    case "actionReceived":
      return {
        queryMode: fromQueryActionMode(payload.event.value.queryMode),
        queryText: payload.event.value.queryText,
        type: "action_received",
      };
    case "sourceLoaded":
      return {
        source: fromQueryActionSourceDescriptorMessage(
          payload.event.value.source
        ),
        type: "source_loaded",
      };
    case "sourceNotFound":
      return {
        sourceKey: payload.event.value.sourceKey,
        type: "source_not_found",
      };
    case "sourceQueryInterfaceMissing":
      return {
        provider: fromWorkflowSourceProvider(payload.event.value.provider),
        sourceStatus: fromWorkflowDataSourceStatus(
          payload.event.value.sourceStatus
        ),
        type: "source_query_interface_missing",
      };
    case "queryValidated":
      return {
        type: "query_validated",
        validatedQuery: payload.event.value.validatedQuery,
      };
    case "queryRejected":
      return {
        detail: payload.event.value.detail,
        type: "query_rejected",
      };
    case "credentialsLoaded":
      return {
        type: "credentials_loaded",
      };
    case "queryPreparationFailed":
      return {
        detail: payload.event.value.detail,
        hint: payload.event.value.hint,
        type: "query_preparation_failed",
      };
    case "queryExecuted":
      return {
        elapsedMs: durationMs(
          requireMessage(payload.event.value.elapsed, "elapsed")
        ),
        rowCount: payload.event.value.rowCount,
        type: "query_executed",
      };
    case "queryUnavailable":
      return {
        detail: payload.event.value.detail,
        type: "query_unavailable",
      };
    case "queryTimedOut":
      return {
        detail: payload.event.value.detail,
        type: "query_timed_out",
      };
    case "queryExecutionFailed":
      return {
        detail: payload.event.value.detail,
        type: "query_execution_failed",
      };
    case "usagePersisted":
      return {
        type: "usage_persisted",
      };
    case "usagePersistFailed":
      return {
        detail: payload.event.value.detail,
        type: "usage_persist_failed",
      };
    case undefined:
      throw new Error("query action event payload missing oneof case");
    default:
      return assertNever(payload.event);
  }
}

function toQueryActionEffectMessage(effect: QueryActionEffect) {
  switch (effect.type) {
    case "prepare_validate_query":
      return create(QueryActionEffectPayloadSchema, {
        effect: {
          case: "prepareValidateQuery",
          value: create(QueryActionPrepareValidateQueryEffectSchema, {
            organizationId: effect.organizationId,
            queryText: effect.queryText,
            sourceKey: effect.sourceKey,
          }),
        },
      });
    case "prepare_execute_query":
      return create(QueryActionEffectPayloadSchema, {
        effect: {
          case: "prepareExecuteQuery",
          value: create(QueryActionPrepareExecuteQueryEffectSchema, {
            organizationId: effect.organizationId,
            queryText: effect.queryText,
            sourceKey: effect.sourceKey,
          }),
        },
      });
    case "execute_query":
      return create(QueryActionEffectPayloadSchema, {
        effect: {
          case: "executeQuery",
          value: create(QueryActionExecuteQueryEffectSchema, {
            source: toQueryActionSourceDescriptorMessage(effect.source),
            validatedQuery: effect.validatedQuery,
          }),
        },
      });
    case "persist_usage":
      return create(QueryActionEffectPayloadSchema, {
        effect: {
          case: "persistUsage",
          value: create(QueryActionPersistUsageEffectSchema, {
            sourceId: effect.sourceId,
          }),
        },
      });
    default:
      return assertNever(effect);
  }
}

function fromQueryActionEffectMessage(
  payload: ProtoQueryActionEffectPayload
): QueryActionEffect {
  switch (payload.effect.case) {
    case "prepareValidateQuery":
      return {
        organizationId: payload.effect.value.organizationId,
        queryText: payload.effect.value.queryText,
        sourceKey: payload.effect.value.sourceKey,
        type: "prepare_validate_query",
      };
    case "prepareExecuteQuery":
      return {
        organizationId: payload.effect.value.organizationId,
        queryText: payload.effect.value.queryText,
        sourceKey: payload.effect.value.sourceKey,
        type: "prepare_execute_query",
      };
    case "executeQuery":
      return {
        source: fromQueryActionSourceDescriptorMessage(
          payload.effect.value.source
        ),
        type: "execute_query",
        validatedQuery: payload.effect.value.validatedQuery,
      };
    case "persistUsage":
      return {
        sourceId: payload.effect.value.sourceId,
        type: "persist_usage",
      };
    case undefined:
      throw new Error("query action effect payload missing oneof case");
    default:
      return assertNever(payload.effect);
  }
}

function toQueryActionSourceDescriptorMessage(
  source: QueryActionSourceDescriptor
) {
  return create(QueryActionSourceDescriptorSchema, {
    ...(source.displayName === null ? {} : { displayName: source.displayName }),
    name: source.name,
    organizationId: source.organizationId,
    provider: toWorkflowSourceProvider(source.provider),
    sourceId: source.sourceId,
    sourceKey: source.sourceKey,
    sourceStatus: toWorkflowDataSourceStatus(source.sourceStatus),
  });
}

function fromQueryActionSourceDescriptorMessage(
  source: ProtoQueryActionSourceDescriptor | undefined
): QueryActionSourceDescriptor {
  const value = requireMessage(source, "source");

  return {
    displayName: isFieldSet(
      value,
      QueryActionSourceDescriptorSchema.field.displayName
    )
      ? value.displayName
      : null,
    name: value.name,
    organizationId: value.organizationId,
    provider: fromWorkflowSourceProvider(value.provider),
    sourceId: value.sourceId,
    sourceKey: value.sourceKey,
    sourceStatus: fromWorkflowDataSourceStatus(value.sourceStatus),
  };
}

function toQueryExecutionResultMessage(response: CliQuerySuccessResult) {
  return create(QueryActionRecordQueryExecutionResultSchema, {
    columns: response.columns.map((column) =>
      create(QueryActionQueryColumnSchema, {
        ...(column.logicalType === null
          ? {}
          : { logicalType: toQueryLogicalType(column.logicalType) }),
        name: column.name,
      })
    ),
    elapsed: durationFromMs(response.elapsedMs),
    rowCount: response.rowCount,
    rows: response.rows.map((row) =>
      create(QueryActionQueryRowSchema, {
        displayValues: [...row],
      })
    ),
    source: create(QueryActionQuerySourceRecordSchema, {
      ...(response.source.displayName === null
        ? {}
        : { displayName: response.source.displayName }),
      provider: toWorkflowSourceProvider(response.source.provider),
      sourceId: response.source.id,
      sourceKey: response.source.sourceKey,
      sourceStatus: toWorkflowDataSourceStatus(response.source.status),
    }),
    truncated: response.truncated,
  });
}

function fromQueryExecutionResultMessage(
  response: ProtoQueryExecutionResult | undefined
): CliQuerySuccessResult {
  const value = requireMessage(response, "response");

  return {
    columns: value.columns.map(fromQueryColumnMessage),
    elapsedMs: durationMs(requireMessage(value.elapsed, "elapsed")),
    rowCount: value.rowCount,
    rows: value.rows.map((row) => [...row.displayValues]),
    source: fromQuerySourceRecordMessage(value.source),
    truncated: value.truncated,
  };
}

function fromQueryColumnMessage(column: ProtoQueryActionQueryColumn) {
  return {
    logicalType: isFieldSet(
      column,
      QueryActionQueryColumnSchema.field.logicalType
    )
      ? fromQueryLogicalType(column.logicalType)
      : null,
    name: column.name,
  };
}

function fromQuerySourceRecordMessage(
  source: ProtoQueryActionQuerySourceRecord | undefined
) {
  const value = requireMessage(source, "source");

  return {
    displayName: isFieldSet(
      value,
      QueryActionQuerySourceRecordSchema.field.displayName
    )
      ? value.displayName
      : null,
    id: value.sourceId,
    provider: fromWorkflowSourceProvider(value.provider),
    sourceKey: value.sourceKey,
    status: fromWorkflowDataSourceStatus(value.sourceStatus),
  };
}

function toQueryActionMode(mode: QueryActionMode): ProtoQueryActionMode {
  switch (mode) {
    case "validate":
      return ProtoQueryActionMode.VALIDATE;
    case "execute":
      return ProtoQueryActionMode.EXECUTE;
    default:
      return assertNever(mode);
  }
}

function fromQueryActionMode(mode: ProtoQueryActionMode): QueryActionMode {
  switch (mode) {
    case ProtoQueryActionMode.VALIDATE:
      return "validate";
    case ProtoQueryActionMode.EXECUTE:
      return "execute";
    case ProtoQueryActionMode.UNSPECIFIED:
      throw new Error("query action mode is unspecified");
    default:
      throw new Error(`unsupported query action mode: ${mode}`);
  }
}

function toQueryLogicalType(
  value: NonNullable<CliQuerySuccessResult["columns"][number]["logicalType"]>
): ProtoQueryLogicalType {
  switch (value) {
    case "string":
      return ProtoQueryLogicalType.STRING;
    case "number":
      return ProtoQueryLogicalType.NUMBER;
    case "boolean":
      return ProtoQueryLogicalType.BOOLEAN;
    case "bigint":
      return ProtoQueryLogicalType.BIGINT;
    case "datetime":
      return ProtoQueryLogicalType.DATETIME;
    case "array":
      return ProtoQueryLogicalType.ARRAY;
    case "json":
      return ProtoQueryLogicalType.JSON;
    default:
      return assertNever(value);
  }
}

function fromQueryLogicalType(
  value: ProtoQueryLogicalType
): NonNullable<CliQuerySuccessResult["columns"][number]["logicalType"]> {
  switch (value) {
    case ProtoQueryLogicalType.STRING:
      return "string";
    case ProtoQueryLogicalType.NUMBER:
      return "number";
    case ProtoQueryLogicalType.BOOLEAN:
      return "boolean";
    case ProtoQueryLogicalType.BIGINT:
      return "bigint";
    case ProtoQueryLogicalType.DATETIME:
      return "datetime";
    case ProtoQueryLogicalType.ARRAY:
      return "array";
    case ProtoQueryLogicalType.JSON:
      return "json";
    case ProtoQueryLogicalType.UNSPECIFIED:
      throw new Error("query logical type is unspecified");
    default:
      throw new Error(`unsupported query logical type: ${value}`);
  }
}

function toWorkflowSourceProvider(provider: ProviderType) {
  switch (provider) {
    case "postgres":
      return WorkflowSourceProvider.POSTGRES;
    case "supabase":
      return WorkflowSourceProvider.SUPABASE;
    case "mysql":
      return WorkflowSourceProvider.MYSQL;
    case "mongodb":
      return WorkflowSourceProvider.MONGODB;
    case "bigquery":
      return WorkflowSourceProvider.BIGQUERY;
    case "laminar":
      return WorkflowSourceProvider.LAMINAR;
    case "aws_athena_connector":
      return WorkflowSourceProvider.AWS_ATHENA_CONNECTOR;
    case "ga":
      return WorkflowSourceProvider.GOOGLE_ANALYTICS;
    case "amplitude":
      return WorkflowSourceProvider.AMPLITUDE;
    case "mixpanel":
      return WorkflowSourceProvider.MIXPANEL;
    case "posthog":
      return WorkflowSourceProvider.POSTHOG;
    case "sentry":
      return WorkflowSourceProvider.SENTRY;
    case "github":
      return WorkflowSourceProvider.GITHUB;
    case "linear":
      return WorkflowSourceProvider.LINEAR;
    case "cloudflare_workers_observability":
      return WorkflowSourceProvider.CLOUDFLARE_WORKERS_OBSERVABILITY;
    default:
      return assertNever(provider);
  }
}

function fromWorkflowSourceProvider(
  provider: WorkflowSourceProvider
): ProviderType {
  switch (provider) {
    case WorkflowSourceProvider.POSTGRES:
      return "postgres";
    case WorkflowSourceProvider.SUPABASE:
      return "supabase";
    case WorkflowSourceProvider.MYSQL:
      return "mysql";
    case WorkflowSourceProvider.MONGODB:
      return "mongodb";
    case WorkflowSourceProvider.BIGQUERY:
      return "bigquery";
    case WorkflowSourceProvider.LAMINAR:
      return "laminar";
    case WorkflowSourceProvider.AWS_ATHENA_CONNECTOR:
      return "aws_athena_connector";
    case WorkflowSourceProvider.GOOGLE_ANALYTICS:
      return "ga";
    case WorkflowSourceProvider.AMPLITUDE:
      return "amplitude";
    case WorkflowSourceProvider.MIXPANEL:
      return "mixpanel";
    case WorkflowSourceProvider.POSTHOG:
      return "posthog";
    case WorkflowSourceProvider.SENTRY:
      return "sentry";
    case WorkflowSourceProvider.GITHUB:
      return "github";
    case WorkflowSourceProvider.LINEAR:
      return "linear";
    case WorkflowSourceProvider.CLOUDFLARE_WORKERS_OBSERVABILITY:
      return "cloudflare_workers_observability";
    case WorkflowSourceProvider.UNSPECIFIED:
      throw new Error("workflow source provider is unspecified");
    default:
      throw new Error(`unsupported workflow source provider: ${provider}`);
  }
}

function toWorkflowDataSourceStatus(status: DataSourceStatus) {
  switch (status) {
    case "active":
      return WorkflowDataSourceStatus.ACTIVE;
    case "error":
      return WorkflowDataSourceStatus.ERROR;
    case "disconnected":
      return WorkflowDataSourceStatus.DISCONNECTED;
    default:
      return assertNever(status);
  }
}

function fromWorkflowDataSourceStatus(
  status: WorkflowDataSourceStatus
): DataSourceStatus {
  switch (status) {
    case WorkflowDataSourceStatus.ACTIVE:
      return "active";
    case WorkflowDataSourceStatus.ERROR:
      return "error";
    case WorkflowDataSourceStatus.DISCONNECTED:
      return "disconnected";
    case WorkflowDataSourceStatus.UNSPECIFIED:
      throw new Error("workflow data source status is unspecified");
    default:
      throw new Error(`unsupported workflow data source status: ${status}`);
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
