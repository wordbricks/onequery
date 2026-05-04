import { isFieldSet } from "@bufbuild/protobuf";
import { durationMs } from "@bufbuild/protobuf/wkt";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";
import {
  QueryActionCommandPayloadSchema,
  QueryActionEventPayloadSchema,
  QueryActionMode,
  QueryActionSourceDescriptorSchema,
} from "@onequery/proto-workflow/workflow/v1/query_action_pb";
import type {
  QueryActionEventPayload as ProtoQueryActionEventPayload,
  QueryActionSourceDescriptor as ProtoQueryActionSourceDescriptor,
} from "@onequery/proto-workflow/workflow/v1/query_action_pb";

import { assertNever, requireProtoMessage } from "./protobuf-utils";
import type { QueryActionEventRecord } from "./types";
import {
  assertPayloadType,
  decodeValidatedAuditFeedPayload,
  fromWorkflowDataSourceStatus,
  fromWorkflowSourceProvider,
  readAuditFeedProjectionPayload,
} from "./workflow-payload-codec";

type QueryActionStartCommandPayload = {
  sourceKey: string;
  type: "start_execute" | "start_validate";
};

type QueryActionSourceDescriptorPayload = {
  displayName: string | null;
  name: string;
  organizationId: string;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
  sourceStatus: DataSourceStatus;
};

type QueryActionEventPayload =
  | {
      queryMode: "execute" | "validate";
      queryText: string;
      type: "action_received";
    }
  | {
      source: QueryActionSourceDescriptorPayload;
      type: "source_loaded";
    }
  | {
      sourceKey: string;
      type: "source_not_found";
    }
  | {
      provider: ProviderType;
      sourceStatus: DataSourceStatus;
      type: "source_query_interface_missing";
    }
  | {
      type: "query_validated";
      validatedQuery: string;
    }
  | {
      detail: string;
      type: "query_rejected";
    }
  | {
      type: "credentials_loaded";
    }
  | {
      detail: string;
      hint: string;
      type: "query_preparation_failed";
    }
  | {
      elapsedMs: number;
      rowCount: number;
      type: "query_executed";
    }
  | {
      detail: string;
      type: "query_unavailable";
    }
  | {
      detail: string;
      type: "query_timed_out";
    }
  | {
      detail: string;
      type: "query_execution_failed";
    }
  | {
      type: "usage_persisted";
    }
  | {
      detail: string;
      type: "usage_persist_failed";
    };

export function parseQueryActionStartCommand(
  record: QueryActionEventRecord
): QueryActionStartCommandPayload {
  return readAuditFeedProjectionPayload({
    entity: "query_action_command_payload",
    family: "query_action",
    payloadType: record.commandType,
    record,
    read: () => {
      const payload = decodeValidatedAuditFeedPayload(
        QueryActionCommandPayloadSchema,
        record.commandPayloadBytes
      );

      switch (payload.command.case) {
        case "startValidate":
          assertPayloadType({
            actionId: record.actionId,
            actual: "start_validate",
            expected: record.commandType,
            family: "query_action",
          });
          return {
            sourceKey: payload.command.value.sourceKey,
            type: "start_validate",
          };
        case "startExecute":
          assertPayloadType({
            actionId: record.actionId,
            actual: "start_execute",
            expected: record.commandType,
            family: "query_action",
          });
          return {
            sourceKey: payload.command.value.sourceKey,
            type: "start_execute",
          };
        case undefined:
          throw new Error(
            `query_action ${record.actionId} command payload is missing its oneof case`
          );
        default:
          throw new Error(
            `query_action ${record.actionId} projection expected a start command but loaded ${record.commandType}`
          );
      }
    },
  });
}

export function parseQueryActionEventPayload(
  record: QueryActionEventRecord
): QueryActionEventPayload {
  return readAuditFeedProjectionPayload({
    entity: "query_action_event_payload",
    family: "query_action",
    payloadType: record.eventType,
    record,
    read: () => {
      const payload = decodeValidatedAuditFeedPayload(
        QueryActionEventPayloadSchema,
        record.payloadBytes
      );
      const event = fromQueryActionEventPayload(payload);
      assertPayloadType({
        actionId: record.actionId,
        actual: event.type,
        expected: record.eventType,
        family: "query_action",
      });
      return event;
    },
  });
}

function fromQueryActionEventPayload(
  payload: ProtoQueryActionEventPayload
): QueryActionEventPayload {
  switch (payload.event.case) {
    case "actionReceived":
      return {
        queryMode: fromQueryActionMode(payload.event.value.queryMode),
        queryText: payload.event.value.queryText,
        type: "action_received",
      };
    case "sourceLoaded":
      return {
        source: fromQueryActionSourceDescriptor(payload.event.value.source),
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
          requireProtoMessage(payload.event.value.elapsed, "elapsed")
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

function fromQueryActionSourceDescriptor(
  source: ProtoQueryActionSourceDescriptor | undefined
): QueryActionSourceDescriptorPayload {
  const value = requireProtoMessage(source, "source");

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

function fromQueryActionMode(
  mode: QueryActionMode
): Extract<QueryActionEventPayload, { type: "action_received" }>["queryMode"] {
  switch (mode) {
    case QueryActionMode.VALIDATE:
      return "validate";
    case QueryActionMode.EXECUTE:
      return "execute";
    case QueryActionMode.UNSPECIFIED:
      throw new Error("query action mode is unspecified");
    default:
      throw new Error(`unsupported query action mode: ${mode}`);
  }
}
