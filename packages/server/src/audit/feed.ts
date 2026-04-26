import { fromBinary, isFieldSet } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { durationMs } from "@bufbuild/protobuf/wkt";
import { createValidator } from "@bufbuild/protovalidate";
import {
  AUDIT_FAMILIES,
  auditListResponseSchema,
  auditOriginActorSchema,
  auditQueryActionMetricsSchema,
  auditQueryActionPreviewSchema,
  auditSourceApiActionMetricsSchema,
  auditSourceApiActionPreviewSchema,
  auditTargetSchema,
} from "@onequery/contracts/audit";
import type {
  AuditFamily,
  AuditListQuery,
  AuditListResponse,
  AuditOriginActor,
  AuditOutcome,
  AuditProjectionLag,
  AuditProjectedThrough,
  AuditQueryActionEventType,
  AuditQueryActionFailureCode,
  AuditQueryActionMetrics,
  AuditQueryActionPhase,
  AuditSourceApiActionEventType,
  AuditSourceApiActionFailureCode,
  AuditSourceApiActionMetrics,
  AuditSourceApiActionPhase,
  AuditTarget,
} from "@onequery/contracts/audit";
import {
  WorkflowDataSourceStatus,
  WorkflowSourceProvider,
} from "@onequery/contracts/workflow/v1/common_pb";
import {
  QueryActionCommandPayloadSchema,
  QueryActionEventPayloadSchema,
  QueryActionMode,
  QueryActionSourceDescriptorSchema,
} from "@onequery/contracts/workflow/v1/query_action_pb";
import type {
  QueryActionEventPayload as ProtoQueryActionEventPayload,
  QueryActionSourceDescriptor as ProtoQueryActionSourceDescriptor,
} from "@onequery/contracts/workflow/v1/query_action_pb";
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
import {
  and,
  asc,
  auditFeedEntries,
  auditProjectionCheckpoints,
  desc,
  eq,
  gt,
  inArray,
  lt,
  or,
  queryActionEvents,
  sourceApiActionEvents,
  sql,
  workflowCommands,
} from "@onequery/db/server";
import type {
  DataSourceStatus,
  Database,
  ProviderType,
  WorkflowActorSnapshotJson,
  WorkflowFamily,
  WorkflowProjectionJson,
  WorkflowSurface,
} from "@onequery/db/server";
import { z } from "zod";

const AUDIT_FEED_PROJECTION_NAME = "audit_feed_entries";
const AUDIT_PROJECTION_BATCH_SIZE = 200;
const AUDIT_PROJECTION_MAX_BATCHES_PER_REQUEST = 5;
const auditFeedPayloadValidator = createValidator();

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
      type: "source_not_queryable";
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

type SourceApiRequestDescriptorPayload = {
  descriptorVersion: string | null;
  kind: "http_request" | "structured_request" | null;
  method: string | null;
  operation: string;
  paginationPolicy: "continuation_token" | "none" | null;
  selector: string | null;
};

type SourceApiStartCommandPayload =
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

type SourceApiSourceDescriptorPayload = {
  displayName: string | null;
  provider: ProviderType;
  sourceId: string;
  sourceKey: string;
};

type SourceApiDescriptorResolutionFailureCode = Extract<
  AuditSourceApiActionFailureCode,
  "descriptor_unavailable" | "permission_denied"
>;
type SourceApiRequestPreparationFailureCode = Extract<
  AuditSourceApiActionFailureCode,
  "execution_state_invalid" | "invalid_request" | "permission_denied"
>;
type SourceApiPageFetchFailureCode = Extract<
  AuditSourceApiActionFailureCode,
  | "execution_failed"
  | "execution_state_invalid"
  | "invalid_request"
  | "request_timed_out"
>;

type SourceApiEventPayload =
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

// Comment: projection rows retain richer preview state than the public feed
// contract exposes, so storage and API schemas stay separate here.
const QueryActionProjectionPreviewSchema = z
  .object({
    elapsedMs: z.number().int().nullable(),
    errorDetail: z.string().nullable(),
    errorHint: z.string().nullable(),
    queryText: z.string(),
    rowCount: z.number().int().nullable(),
    usageRecordingStatus: z.enum(["not_started", "succeeded", "failed"]),
    validatedQuery: z.string().nullable(),
  })
  .strict();
type QueryActionProjectionPreview = z.infer<
  typeof QueryActionProjectionPreviewSchema
>;

const SourceApiActionProjectionPreviewSchema = z
  .object({
    attemptNumber: z.number().int().nullable(),
    errorDetail: z.string().nullable(),
    httpStatus: z.number().int().nullable(),
    invokeMode: z.enum(["preview_only", "execute"]).nullable(),
    method: z.string().nullable(),
    operation: z.string().nullable(),
    pageCount: z.number().int().nullable(),
    responseBytes: z.number().int().nullable(),
    selector: z.string().nullable(),
  })
  .strict();
type SourceApiActionProjectionPreview = z.infer<
  typeof SourceApiActionProjectionPreviewSchema
>;

type DatabaseExecutor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

type AuditCursor = {
  family: AuditFamily;
  familyActionId: string;
  startedAt: Date;
};

type AuditProjectionCheckpointSnapshot = {
  queryAction: bigint | null;
  sourceApiAction: bigint | null;
};

type AuditProjectionCheckpointPositions = {
  queryAction: bigint;
  sourceApiAction: bigint;
};

type QueryActionProjectionRow = {
  actionName: "validate" | "execute";
  completedAt: Date | null;
  failureCode: AuditQueryActionFailureCode | null;
  family: "query_action";
  familyActionId: string;
  lastEventAt: Date;
  lastProjectedSequence: number;
  lastEventType: AuditQueryActionEventType;
  metrics: AuditQueryActionMetrics | null;
  organizationId: string;
  originActor: AuditOriginActor;
  originSurface: WorkflowSurface;
  outcome: AuditOutcome;
  phase: AuditQueryActionPhase;
  preview: QueryActionProjectionPreview;
  searchDocument: string;
  startedAt: Date;
  subtitle: string;
  target: AuditTarget;
  title: string;
};

type SourceApiActionProjectionRow = {
  actionName: "describe" | "invoke";
  completedAt: Date | null;
  failureCode: AuditSourceApiActionFailureCode | null;
  family: "source_api_action";
  familyActionId: string;
  lastEventAt: Date;
  lastProjectedSequence: number;
  lastEventType: AuditSourceApiActionEventType;
  metrics: AuditSourceApiActionMetrics | null;
  organizationId: string;
  originActor: AuditOriginActor;
  originSurface: WorkflowSurface;
  outcome: AuditOutcome;
  phase: AuditSourceApiActionPhase;
  preview: SourceApiActionProjectionPreview;
  searchDocument: string;
  startedAt: Date;
  subtitle: string;
  target: AuditTarget;
  title: string;
};

type QueryActionEventRecord = {
  actionId: string;
  actorSnapshotJson: WorkflowActorSnapshotJson;
  commandId: string;
  commandPayloadBytes: Buffer;
  commandType: string;
  commitPosition: bigint;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  organizationId: string;
  payloadBytes: Buffer;
  sequence: number;
  surface: WorkflowSurface;
};

type SourceApiActionEventRecord = {
  actionId: string;
  actorSnapshotJson: WorkflowActorSnapshotJson;
  commandId: string;
  commandPayloadBytes: Buffer;
  commandType: string;
  commitPosition: bigint;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  organizationId: string;
  payloadBytes: Buffer;
  sequence: number;
  surface: WorkflowSurface;
};

type AuditProjectionRow =
  | QueryActionProjectionRow
  | SourceApiActionProjectionRow;
type QueryActionProjectionRowCore = Omit<
  QueryActionProjectionRow,
  "searchDocument" | "subtitle" | "title"
>;
type SourceApiActionProjectionRowCore = Omit<
  SourceApiActionProjectionRow,
  "searchDocument" | "subtitle" | "title"
>;

export class InvalidAuditCursorError extends Error {
  constructor() {
    super("Invalid cursor");
  }
}

type AuditFeedProjectionPayloadEntity =
  | "query_action_command_payload"
  | "query_action_event_payload"
  | "source_api_action_command_payload"
  | "source_api_action_event_payload";

type AuditFeedProjectionPayloadRecord = {
  actionId: string;
  commandId: string;
  eventId: string;
};

export class AuditFeedProjectionCorruptPayloadError extends Error {
  readonly actionId: string;
  override readonly cause: unknown;
  readonly commandId: string;
  readonly entity: AuditFeedProjectionPayloadEntity;
  readonly eventId: string;
  readonly family: WorkflowFamily;
  readonly payloadType: string;

  constructor(input: {
    actionId: string;
    cause: unknown;
    commandId: string;
    entity: AuditFeedProjectionPayloadEntity;
    eventId: string;
    family: WorkflowFamily;
    payloadType: string;
  }) {
    super(
      `audit feed projection payload is corrupt (${formatAuditFeedProjectionCorruptPayloadDiagnostic(input)})`,
      {
        cause: input.cause instanceof Error ? input.cause : undefined,
      }
    );
    this.name = "AuditFeedProjectionCorruptPayloadError";
    this.actionId = input.actionId;
    this.cause = input.cause;
    this.commandId = input.commandId;
    this.entity = input.entity;
    this.eventId = input.eventId;
    this.family = input.family;
    this.payloadType = input.payloadType;
  }
}

function formatAuditFeedProjectionCorruptPayloadDiagnostic(input: {
  actionId: string;
  commandId: string;
  entity: AuditFeedProjectionPayloadEntity;
  eventId: string;
  family: WorkflowFamily;
  payloadType: string;
}) {
  return [
    `family=${input.family}`,
    `entity=${input.entity}`,
    `actionId=${input.actionId}`,
    `commandId=${input.commandId}`,
    `eventId=${input.eventId}`,
    `payloadType=${input.payloadType}`,
  ].join(" ");
}

export function buildAuditFeedId(family: AuditFamily, familyActionId: string) {
  return `${family}:${familyActionId}`;
}

function escapeLikePattern(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function buildCaseInsensitiveContains(column: unknown, value: string) {
  const pattern = `%${escapeLikePattern(value.toLowerCase())}%`;
  return sql`lower(coalesce(${column}, '')) like ${pattern} escape '\\'`;
}

function buildCaseInsensitiveEquals(column: unknown, value: string) {
  return sql`lower(coalesce(${column}, '')) = ${value.toLowerCase()}`;
}

function decodeAuditCursor(cursor: string): AuditCursor | null {
  const parts = cursor.split("|");
  if (parts.length !== 3) {
    return null;
  }

  const startedAtText = parts[0];
  const family = parts[1];
  const familyActionId = parts[2];
  if (!startedAtText || !family || !familyActionId) {
    return null;
  }

  const startedAt = new Date(startedAtText);

  if (
    Number.isNaN(startedAt.getTime()) ||
    !AUDIT_FAMILIES.includes(family as AuditFamily) ||
    familyActionId.length === 0
  ) {
    return null;
  }

  return {
    family: family as AuditFamily,
    familyActionId,
    startedAt,
  };
}

function encodeAuditCursor(cursor: AuditCursor) {
  return `${cursor.startedAt.toISOString()}|${cursor.family}|${cursor.familyActionId}`;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function singleLine(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value.replaceAll(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength = 160) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function buildSearchDocument(parts: Array<string | number | null | undefined>) {
  return parts
    .flatMap((part) => {
      if (part === null || part === undefined) {
        return [];
      }

      const text = typeof part === "number" ? `${part}` : singleLine(part);
      return text.length === 0 ? [] : [text];
    })
    .join("\n");
}

function normalizeOriginActor(
  actorSnapshotJson: WorkflowActorSnapshotJson
): AuditOriginActor {
  return auditOriginActorSchema.parse(actorSnapshotJson);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected workflow payload variant: ${String(value)}`);
}

function requireProtoMessage<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined) {
    throw new Error(`workflow protobuf field ${fieldName} is missing`);
  }

  return value;
}

function decodeValidatedAuditFeedPayload<Schema extends DescMessage>(
  schema: Schema,
  bytes: Buffer
): MessageShape<Schema> {
  const decoded = fromBinary(schema, bytes);
  const validation = auditFeedPayloadValidator.validate(schema, decoded);
  if (validation.kind !== "valid") {
    throw validation.error;
  }

  return decoded;
}

function readAuditFeedProjectionPayload<T>(input: {
  entity: AuditFeedProjectionPayloadEntity;
  family: WorkflowFamily;
  payloadType: string;
  read: () => T;
  record: AuditFeedProjectionPayloadRecord;
}): T {
  try {
    return input.read();
  } catch (cause: unknown) {
    if (cause instanceof AuditFeedProjectionCorruptPayloadError) {
      throw cause;
    }

    throw new AuditFeedProjectionCorruptPayloadError({
      actionId: input.record.actionId,
      cause,
      commandId: input.record.commandId,
      entity: input.entity,
      eventId: input.record.eventId,
      family: input.family,
      payloadType: input.payloadType,
    });
  }
}

function assertPayloadType(input: {
  actionId: string;
  actual: string;
  expected: string;
  family: WorkflowFamily;
}) {
  if (input.actual !== input.expected) {
    throw new Error(
      `${input.family} ${input.actionId} expected ${input.expected} payload but decoded ${input.actual}`
    );
  }
}

function parseQueryActionStartCommand(
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

function parseSourceApiStartCommand(
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

function parseQueryActionEventPayload(
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

function parseSourceApiEventPayload(
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
    case "sourceNotQueryable":
      return {
        provider: fromWorkflowSourceProvider(payload.event.value.provider),
        sourceStatus: fromWorkflowDataSourceStatus(
          payload.event.value.sourceStatus
        ),
        type: "source_not_queryable",
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
    case WorkflowSourceProvider.UNSPECIFIED:
      throw new Error("workflow source provider is unspecified");
    default:
      throw new Error(`unsupported workflow source provider: ${provider}`);
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

function normalizeQueryActionMetrics(
  preview: QueryActionProjectionPreview
): AuditQueryActionMetrics | null {
  if (preview.elapsedMs === null && preview.rowCount === null) {
    return null;
  }

  return {
    elapsedMs: preview.elapsedMs,
    rowCount: preview.rowCount,
  };
}

function normalizeSourceApiMetrics(
  preview: SourceApiActionProjectionPreview
): AuditSourceApiActionMetrics | null {
  if (
    preview.httpStatus === null &&
    preview.pageCount === null &&
    preview.responseBytes === null
  ) {
    return null;
  }

  return {
    httpStatus: preview.httpStatus,
    pageCount: preview.pageCount,
    responseBytes: preview.responseBytes,
  };
}

function buildQueryActionTitle(row: QueryActionProjectionRowCore) {
  const sourceLabel =
    row.target.displayName ?? row.target.sourceName ?? row.target.sourceKey;
  return `${formatLabel(row.actionName)} query on ${sourceLabel}`;
}

function buildQueryActionSubtitle(row: QueryActionProjectionRowCore) {
  if (row.preview.errorDetail) {
    return truncate(singleLine(row.preview.errorDetail));
  }

  return truncate(singleLine(row.preview.queryText));
}

function buildSourceApiActionTitle(row: SourceApiActionProjectionRowCore) {
  const sourceLabel = row.target.displayName ?? row.target.sourceKey;

  if (row.actionName === "describe") {
    return `Describe source ${sourceLabel}`;
  }

  if (row.preview.operation) {
    return `Invoke ${row.preview.operation} on ${sourceLabel}`;
  }

  return `Invoke source ${sourceLabel}`;
}

function buildSourceApiActionSubtitle(row: SourceApiActionProjectionRowCore) {
  if (row.preview.errorDetail) {
    return truncate(singleLine(row.preview.errorDetail));
  }

  const descriptorLabel = singleLine(
    [row.preview.method, row.preview.selector].filter(Boolean).join(" ")
  );
  if (descriptorLabel.length > 0) {
    return truncate(descriptorLabel);
  }

  if (row.preview.invokeMode === "preview_only") {
    return "Preview only";
  }

  if (row.preview.invokeMode === "execute") {
    return "Execute request";
  }

  return "";
}

function finalizeQueryActionRow(
  row: Omit<QueryActionProjectionRowCore, "metrics"> & {
    metrics?: AuditQueryActionMetrics | null;
  }
): QueryActionProjectionRow {
  const finalized = {
    ...row,
    metrics:
      row.metrics === undefined
        ? normalizeQueryActionMetrics(row.preview)
        : row.metrics,
  } satisfies QueryActionProjectionRowCore;

  const title = buildQueryActionTitle(finalized);
  const subtitle = buildQueryActionSubtitle(finalized);

  return {
    ...finalized,
    // Comment: search_document stays aligned with public feed text so
    // internal-only preview hints do not become searchable.
    searchDocument: buildSearchDocument([
      title,
      subtitle,
      finalized.actionName,
      finalized.originActor.email,
      finalized.target.sourceKey,
      finalized.target.sourceId,
      finalized.target.provider,
      finalized.target.displayName,
      finalized.target.sourceName,
      finalized.preview.queryText,
      finalized.preview.validatedQuery,
      finalized.failureCode,
      finalized.phase,
      finalized.outcome,
      finalized.lastEventType,
      finalized.metrics?.elapsedMs,
      finalized.metrics?.rowCount,
    ]),
    subtitle,
    title,
  };
}

function finalizeSourceApiActionRow(
  row: Omit<SourceApiActionProjectionRowCore, "metrics"> & {
    metrics?: AuditSourceApiActionMetrics | null;
  }
): SourceApiActionProjectionRow {
  const finalized = {
    ...row,
    metrics:
      row.metrics === undefined
        ? normalizeSourceApiMetrics(row.preview)
        : row.metrics,
  } satisfies SourceApiActionProjectionRowCore;

  const title = buildSourceApiActionTitle(finalized);
  const subtitle = buildSourceApiActionSubtitle(finalized);

  return {
    ...finalized,
    searchDocument: buildSearchDocument([
      title,
      subtitle,
      finalized.actionName,
      finalized.originActor.email,
      finalized.target.sourceKey,
      finalized.target.sourceId,
      finalized.target.provider,
      finalized.target.displayName,
      finalized.preview.invokeMode,
      finalized.preview.operation,
      finalized.preview.method,
      finalized.preview.selector,
      finalized.preview.errorDetail,
      finalized.failureCode,
      finalized.phase,
      finalized.outcome,
      finalized.lastEventType,
      finalized.metrics?.httpStatus,
      finalized.metrics?.pageCount,
      finalized.metrics?.responseBytes,
      finalized.preview.attemptNumber,
    ]),
    subtitle,
    title,
  };
}

function createQueryActionRowFromStart(
  record: QueryActionEventRecord
): QueryActionProjectionRow {
  const payload = parseQueryActionEventPayload(record);
  if (payload.type !== "action_received") {
    throw new Error(
      `query_action ${record.actionId} projection started from ${payload.type}`
    );
  }

  const startCommand = parseQueryActionStartCommand(record);
  const preview = QueryActionProjectionPreviewSchema.parse({
    elapsedMs: null,
    errorDetail: null,
    errorHint: null,
    queryText: payload.queryText,
    rowCount: null,
    usageRecordingStatus: "not_started",
    validatedQuery: null,
  });
  const target = auditTargetSchema.parse({
    displayName: null,
    provider: null,
    sourceId: null,
    sourceKey: startCommand.sourceKey,
    sourceName: null,
  });

  return finalizeQueryActionRow({
    actionName: payload.queryMode,
    completedAt: null,
    failureCode: null,
    family: "query_action",
    familyActionId: record.actionId,
    lastEventAt: record.occurredAt,
    lastProjectedSequence: record.sequence,
    lastEventType: payload.type,
    organizationId: record.organizationId,
    originActor: normalizeOriginActor(record.actorSnapshotJson),
    originSurface: record.surface,
    outcome: "pending",
    phase: "load_source",
    preview,
    startedAt: record.occurredAt,
    target,
  });
}

function reduceQueryActionRow(
  row: QueryActionProjectionRow,
  record: QueryActionEventRecord
): QueryActionProjectionRow {
  if (record.sequence <= row.lastProjectedSequence) {
    return row;
  }

  const payload = parseQueryActionEventPayload(record);
  const next = {
    ...row,
    completedAt: row.completedAt,
    lastEventAt: record.occurredAt,
    lastProjectedSequence: record.sequence,
    lastEventType: payload.type,
    metrics: row.metrics,
    preview: { ...row.preview },
    target: { ...row.target },
  };

  switch (payload.type) {
    case "action_received":
      return row;
    case "source_loaded":
      next.phase = "validate_query";
      next.preview.errorDetail = null;
      next.preview.errorHint = null;
      next.target.displayName = payload.source.displayName;
      next.target.provider = payload.source.provider;
      next.target.sourceId = payload.source.sourceId;
      next.target.sourceKey = payload.source.sourceKey;
      next.target.sourceName = payload.source.name;
      break;
    case "source_not_found":
      next.completedAt = record.occurredAt;
      next.failureCode = "source_not_found";
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = `Source "${payload.sourceKey}" was not found`;
      next.preview.errorHint = null;
      break;
    case "source_not_queryable":
      next.completedAt = record.occurredAt;
      next.failureCode = "source_not_queryable";
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = `Source is not queryable while ${payload.sourceStatus}`;
      next.preview.errorHint = null;
      next.target.provider = payload.provider;
      break;
    case "query_validated":
      next.preview.errorDetail = null;
      next.preview.errorHint = null;
      next.preview.validatedQuery = payload.validatedQuery;
      if (next.actionName === "validate") {
        next.completedAt = record.occurredAt;
        next.failureCode = null;
        next.outcome = "succeeded";
        next.phase = "completed";
      } else {
        next.completedAt = null;
        next.failureCode = null;
        next.outcome = "pending";
        next.phase = "load_credentials";
      }
      break;
    case "query_rejected":
      next.completedAt = record.occurredAt;
      next.failureCode = "query_rejected";
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = payload.detail;
      next.preview.errorHint = null;
      break;
    case "credentials_loaded":
      next.completedAt = null;
      next.failureCode = null;
      next.outcome = "pending";
      next.phase = "execute_query";
      next.preview.errorDetail = null;
      next.preview.errorHint = null;
      break;
    case "query_preparation_failed":
      next.completedAt = record.occurredAt;
      next.failureCode = "query_preparation_failed";
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = payload.detail;
      next.preview.errorHint = payload.hint;
      break;
    case "query_executed":
      next.completedAt = null;
      next.failureCode = null;
      next.outcome = "pending";
      next.phase = "persist_usage";
      next.preview.elapsedMs = payload.elapsedMs;
      next.preview.errorDetail = null;
      next.preview.errorHint = null;
      next.preview.rowCount = payload.rowCount;
      next.metrics = {
        elapsedMs: payload.elapsedMs,
        rowCount: payload.rowCount,
      };
      break;
    case "query_unavailable":
      next.completedAt = record.occurredAt;
      next.failureCode = "query_unavailable";
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = payload.detail;
      next.preview.errorHint = null;
      break;
    case "query_timed_out":
      next.completedAt = record.occurredAt;
      next.failureCode = "query_timed_out";
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = payload.detail;
      next.preview.errorHint = null;
      break;
    case "query_execution_failed":
      next.completedAt = record.occurredAt;
      next.failureCode = "query_execution_failed";
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = payload.detail;
      next.preview.errorHint = null;
      break;
    case "usage_persisted":
      next.completedAt = record.occurredAt;
      next.failureCode = null;
      next.outcome = "succeeded";
      next.phase = "completed";
      next.preview.errorDetail = null;
      next.preview.errorHint = null;
      next.preview.usageRecordingStatus = "succeeded";
      break;
    case "usage_persist_failed":
      next.completedAt = record.occurredAt;
      next.failureCode = null;
      next.outcome = "succeeded";
      next.phase = "completed";
      next.preview.errorDetail = payload.detail;
      next.preview.errorHint = null;
      next.preview.usageRecordingStatus = "failed";
      break;
  }

  return finalizeQueryActionRow(next);
}

function createSourceApiActionRowFromStart(
  record: SourceApiActionEventRecord
): SourceApiActionProjectionRow {
  const payload = parseSourceApiEventPayload(record);
  if (payload.type !== "action_received") {
    throw new Error(
      `source_api_action ${record.actionId} projection started from ${payload.type}`
    );
  }

  const startCommand = parseSourceApiStartCommand(record);
  const preview = SourceApiActionProjectionPreviewSchema.parse({
    attemptNumber: null,
    errorDetail: null,
    httpStatus: null,
    invokeMode: payload.invokeMode,
    method:
      payload.requestDescriptor?.method ??
      ("requestDescriptor" in startCommand
        ? startCommand.requestDescriptor.method
        : null),
    operation:
      payload.requestDescriptor?.operation ??
      ("requestDescriptor" in startCommand
        ? startCommand.requestDescriptor.operation
        : null),
    pageCount: null,
    responseBytes: null,
    selector:
      payload.requestDescriptor?.selector ??
      ("requestDescriptor" in startCommand
        ? startCommand.requestDescriptor.selector
        : null),
  });
  const target = auditTargetSchema.parse({
    displayName: null,
    provider: null,
    sourceId: null,
    sourceKey: startCommand.sourceKey,
    sourceName: null,
  });

  return finalizeSourceApiActionRow({
    actionName: payload.requestKind === "describe" ? "describe" : "invoke",
    completedAt: null,
    failureCode: null,
    family: "source_api_action",
    familyActionId: record.actionId,
    lastEventAt: record.occurredAt,
    lastProjectedSequence: record.sequence,
    lastEventType: payload.type,
    organizationId: record.organizationId,
    originActor: normalizeOriginActor(record.actorSnapshotJson),
    originSurface: record.surface,
    outcome: "pending",
    phase: "load_source",
    preview,
    startedAt: record.occurredAt,
    target,
  });
}

function reduceSourceApiActionRow(
  row: SourceApiActionProjectionRow,
  record: SourceApiActionEventRecord
): SourceApiActionProjectionRow {
  if (record.sequence <= row.lastProjectedSequence) {
    return row;
  }

  const payload = parseSourceApiEventPayload(record);
  const next = {
    ...row,
    completedAt: row.completedAt,
    lastEventAt: record.occurredAt,
    lastProjectedSequence: record.sequence,
    lastEventType: payload.type,
    metrics: row.metrics,
    preview: { ...row.preview },
    target: { ...row.target },
  };

  switch (payload.type) {
    case "action_received":
      return row;
    case "source_loaded":
      next.completedAt = null;
      next.failureCode = null;
      next.outcome = "pending";
      next.phase = "describe_source";
      next.preview.errorDetail = null;
      next.target.displayName = payload.source.displayName;
      next.target.provider = payload.source.provider;
      next.target.sourceId = payload.source.sourceId;
      next.target.sourceKey = payload.source.sourceKey;
      break;
    case "source_not_found":
      next.completedAt = record.occurredAt;
      next.failureCode = "source_not_found";
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = `Source "${payload.sourceKey}" was not found`;
      break;
    case "descriptor_resolved":
      next.preview.errorDetail = null;
      next.preview.method =
        payload.requestDescriptor?.method ?? next.preview.method ?? null;
      next.preview.operation =
        payload.requestDescriptor?.operation ?? next.preview.operation ?? null;
      next.preview.selector =
        payload.requestDescriptor?.selector ?? next.preview.selector ?? null;
      if (next.actionName === "describe") {
        next.completedAt = record.occurredAt;
        next.failureCode = null;
        next.outcome = "succeeded";
        next.phase = "completed";
      } else {
        next.completedAt = null;
        next.failureCode = null;
        next.outcome = "pending";
        next.phase = "prepare_request";
      }
      break;
    case "descriptor_resolution_failed":
      next.completedAt = record.occurredAt;
      next.failureCode = payload.failureCode;
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = payload.detail;
      break;
    case "request_prepared":
      next.preview.errorDetail = null;
      if (next.preview.invokeMode === "preview_only") {
        next.completedAt = record.occurredAt;
        next.failureCode = null;
        next.outcome = "succeeded";
        next.phase = "completed";
      } else {
        next.completedAt = null;
        next.failureCode = null;
        next.outcome = "pending";
        next.phase = "execute_request";
        next.preview.attemptNumber = 1;
      }
      break;
    case "request_preparation_failed":
      next.completedAt = record.occurredAt;
      next.failureCode = payload.failureCode;
      next.outcome = "failed";
      next.phase = "completed";
      next.preview.errorDetail = payload.detail;
      break;
    case "resume_requested":
      next.completedAt = null;
      next.failureCode = null;
      next.outcome = "pending";
      next.phase = "execute_request";
      next.preview.attemptNumber = payload.attemptNumber;
      next.preview.errorDetail = null;
      break;
    case "page_fetch_succeeded":
      next.preview.attemptNumber = payload.attemptNumber;
      next.preview.errorDetail = null;
      next.preview.httpStatus = payload.httpStatus;
      next.preview.pageCount = payload.pageIndex + 1;
      next.preview.responseBytes = payload.responseBytes;
      next.metrics = {
        httpStatus: payload.httpStatus,
        pageCount: payload.pageIndex + 1,
        responseBytes: payload.responseBytes,
      };
      if (payload.hasContinuation) {
        next.completedAt = null;
        next.failureCode = null;
        next.outcome = "pending";
        next.phase = "await_resume";
      } else {
        next.completedAt = record.occurredAt;
        next.failureCode = null;
        next.outcome = "succeeded";
        next.phase = "completed";
      }
      break;
    case "page_fetch_failed":
      next.preview.attemptNumber = payload.attemptNumber;
      next.preview.errorDetail = payload.detail;
      next.preview.pageCount = payload.pageIndex + 1;
      next.completedAt = record.occurredAt;
      next.failureCode = payload.failureCode;
      next.outcome = "failed";
      next.phase = "completed";
      break;
  }

  return finalizeSourceApiActionRow(next);
}

async function loadAuditCheckpoint(
  db: DatabaseExecutor,
  family: WorkflowFamily
) {
  const [checkpoint] = await db
    .select({
      lastCommitPosition: auditProjectionCheckpoints.lastCommitPosition,
    })
    .from(auditProjectionCheckpoints)
    .where(
      and(
        eq(auditProjectionCheckpoints.family, family),
        eq(
          auditProjectionCheckpoints.projectionName,
          AUDIT_FEED_PROJECTION_NAME
        )
      )
    )
    .limit(1);

  return checkpoint?.lastCommitPosition ?? 0n;
}

async function loadAuditFeedRowsByActionId(
  db: DatabaseExecutor,
  family: WorkflowFamily,
  familyActionIds: readonly string[]
) {
  if (familyActionIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(auditFeedEntries)
    .where(
      and(
        eq(auditFeedEntries.family, family),
        inArray(auditFeedEntries.familyActionId, [...familyActionIds])
      )
    );
}

function parseStoredQueryActionRow(
  row: typeof auditFeedEntries.$inferSelect
): QueryActionProjectionRow {
  return finalizeQueryActionRow({
    actionName:
      row.actionName === "validate" || row.actionName === "execute"
        ? row.actionName
        : (() => {
            throw new Error(
              `invalid query_action action name: ${row.actionName}`
            );
          })(),
    completedAt: row.completedAt,
    failureCode:
      row.failureCode === null
        ? null
        : (row.failureCode as AuditQueryActionFailureCode),
    family: "query_action",
    familyActionId: row.familyActionId,
    lastProjectedSequence: row.lastProjectedSequence,
    lastEventAt: row.lastEventAt,
    lastEventType: row.lastEventType as AuditQueryActionEventType,
    metrics:
      row.metricsJson === null
        ? null
        : auditQueryActionMetricsSchema.parse(row.metricsJson),
    organizationId: row.organizationId,
    originActor: auditOriginActorSchema.parse(row.originActorJson),
    originSurface: row.originSurface,
    outcome: row.outcome as AuditOutcome,
    phase: row.phase as AuditQueryActionPhase,
    preview: QueryActionProjectionPreviewSchema.parse(row.familyPreviewJson),
    startedAt: row.startedAt,
    target: auditTargetSchema.parse(row.targetJson),
  });
}

function parseStoredSourceApiActionRow(
  row: typeof auditFeedEntries.$inferSelect
): SourceApiActionProjectionRow {
  return finalizeSourceApiActionRow({
    actionName:
      row.actionName === "describe" || row.actionName === "invoke"
        ? row.actionName
        : (() => {
            throw new Error(
              `invalid source_api_action action name: ${row.actionName}`
            );
          })(),
    completedAt: row.completedAt,
    failureCode:
      row.failureCode === null
        ? null
        : (row.failureCode as AuditSourceApiActionFailureCode),
    family: "source_api_action",
    familyActionId: row.familyActionId,
    lastProjectedSequence: row.lastProjectedSequence,
    lastEventAt: row.lastEventAt,
    lastEventType: row.lastEventType as AuditSourceApiActionEventType,
    metrics:
      row.metricsJson === null
        ? null
        : auditSourceApiActionMetricsSchema.parse(row.metricsJson),
    organizationId: row.organizationId,
    originActor: auditOriginActorSchema.parse(row.originActorJson),
    originSurface: row.originSurface,
    outcome: row.outcome as AuditOutcome,
    phase: row.phase as AuditSourceApiActionPhase,
    preview: SourceApiActionProjectionPreviewSchema.parse(
      row.familyPreviewJson
    ),
    startedAt: row.startedAt,
    target: auditTargetSchema.parse(row.targetJson),
  });
}

async function loadQueryActionEventBatch(
  db: DatabaseExecutor,
  lastCommitPosition: bigint,
  limit: number
) {
  return db
    .select({
      actionId: queryActionEvents.actionId,
      actorSnapshotJson: workflowCommands.actorSnapshotJson,
      commandId: workflowCommands.id,
      commandPayloadBytes: workflowCommands.commandPayloadBytes,
      commandType: workflowCommands.commandType,
      commitPosition: queryActionEvents.commitPosition,
      eventId: queryActionEvents.id,
      eventType: queryActionEvents.eventType,
      occurredAt: queryActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadBytes: queryActionEvents.payloadBytes,
      sequence: queryActionEvents.sequence,
      surface: workflowCommands.surface,
    })
    .from(queryActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, queryActionEvents.commandId)
    )
    .where(gt(queryActionEvents.commitPosition, lastCommitPosition))
    .orderBy(asc(queryActionEvents.commitPosition))
    .limit(limit);
}

async function loadSourceApiActionEventBatch(
  db: DatabaseExecutor,
  lastCommitPosition: bigint,
  limit: number
) {
  return db
    .select({
      actionId: sourceApiActionEvents.actionId,
      actorSnapshotJson: workflowCommands.actorSnapshotJson,
      commandId: workflowCommands.id,
      commandPayloadBytes: workflowCommands.commandPayloadBytes,
      commandType: workflowCommands.commandType,
      commitPosition: sourceApiActionEvents.commitPosition,
      eventId: sourceApiActionEvents.id,
      eventType: sourceApiActionEvents.eventType,
      occurredAt: sourceApiActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadBytes: sourceApiActionEvents.payloadBytes,
      sequence: sourceApiActionEvents.sequence,
      surface: workflowCommands.surface,
    })
    .from(sourceApiActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, sourceApiActionEvents.commandId)
    )
    .where(gt(sourceApiActionEvents.commitPosition, lastCommitPosition))
    .orderBy(asc(sourceApiActionEvents.commitPosition))
    .limit(limit);
}

async function rebuildQueryActionRow(
  db: DatabaseExecutor,
  actionId: string,
  throughCommitPosition: bigint
) {
  const eventRows = await db
    .select({
      actionId: queryActionEvents.actionId,
      actorSnapshotJson: workflowCommands.actorSnapshotJson,
      commandId: workflowCommands.id,
      commandPayloadBytes: workflowCommands.commandPayloadBytes,
      commandType: workflowCommands.commandType,
      commitPosition: queryActionEvents.commitPosition,
      eventId: queryActionEvents.id,
      eventType: queryActionEvents.eventType,
      occurredAt: queryActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadBytes: queryActionEvents.payloadBytes,
      sequence: queryActionEvents.sequence,
      surface: workflowCommands.surface,
    })
    .from(queryActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, queryActionEvents.commandId)
    )
    .where(
      and(
        eq(queryActionEvents.actionId, actionId),
        lt(queryActionEvents.commitPosition, throughCommitPosition + 1n)
      )
    )
    .orderBy(asc(queryActionEvents.commitPosition));

  let row: QueryActionProjectionRow | null = null;
  for (const eventRow of eventRows) {
    row =
      row === null
        ? createQueryActionRowFromStart(eventRow)
        : reduceQueryActionRow(row, eventRow);
  }

  if (row === null) {
    throw new Error(`query_action ${actionId} could not be rebuilt`);
  }

  return row;
}

async function rebuildSourceApiActionRow(
  db: DatabaseExecutor,
  actionId: string,
  throughCommitPosition: bigint
) {
  const eventRows = await db
    .select({
      actionId: sourceApiActionEvents.actionId,
      actorSnapshotJson: workflowCommands.actorSnapshotJson,
      commandId: workflowCommands.id,
      commandPayloadBytes: workflowCommands.commandPayloadBytes,
      commandType: workflowCommands.commandType,
      commitPosition: sourceApiActionEvents.commitPosition,
      eventId: sourceApiActionEvents.id,
      eventType: sourceApiActionEvents.eventType,
      occurredAt: sourceApiActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadBytes: sourceApiActionEvents.payloadBytes,
      sequence: sourceApiActionEvents.sequence,
      surface: workflowCommands.surface,
    })
    .from(sourceApiActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, sourceApiActionEvents.commandId)
    )
    .where(
      and(
        eq(sourceApiActionEvents.actionId, actionId),
        lt(sourceApiActionEvents.commitPosition, throughCommitPosition + 1n)
      )
    )
    .orderBy(asc(sourceApiActionEvents.commitPosition));

  let row: SourceApiActionProjectionRow | null = null;
  for (const eventRow of eventRows) {
    row =
      row === null
        ? createSourceApiActionRowFromStart(eventRow)
        : reduceSourceApiActionRow(row, eventRow);
  }

  if (row === null) {
    throw new Error(`source_api_action ${actionId} could not be rebuilt`);
  }

  return row;
}

async function upsertAuditFeedRow(
  db: DatabaseExecutor,
  row: AuditProjectionRow
) {
  const previewJson = row.preview as WorkflowProjectionJson;
  const metricsJson = row.metrics as WorkflowProjectionJson | null;

  await db
    .insert(auditFeedEntries)
    .values({
      actionName: row.actionName,
      completedAt: row.completedAt,
      failureCode: row.failureCode,
      family: row.family,
      familyActionId: row.familyActionId,
      familyPreviewJson: previewJson,
      lastProjectedSequence: row.lastProjectedSequence,
      lastEventAt: row.lastEventAt,
      lastEventType: row.lastEventType,
      metricsJson,
      organizationId: row.organizationId,
      originActorJson: row.originActor as WorkflowProjectionJson,
      originSurface: row.originSurface,
      outcome: row.outcome,
      phase: row.phase,
      searchDocument: row.searchDocument,
      startedAt: row.startedAt,
      subtitle: row.subtitle,
      targetJson: row.target as WorkflowProjectionJson,
      title: row.title,
    })
    .onConflictDoUpdate({
      set: {
        actionName: row.actionName,
        completedAt: row.completedAt,
        failureCode: row.failureCode,
        familyPreviewJson: previewJson,
        lastProjectedSequence: row.lastProjectedSequence,
        lastEventAt: row.lastEventAt,
        lastEventType: row.lastEventType,
        metricsJson,
        organizationId: row.organizationId,
        originActorJson: row.originActor as WorkflowProjectionJson,
        originSurface: row.originSurface,
        outcome: row.outcome,
        phase: row.phase,
        searchDocument: row.searchDocument,
        startedAt: row.startedAt,
        subtitle: row.subtitle,
        targetJson: row.target as WorkflowProjectionJson,
        title: row.title,
      },
      setWhere: sql`${auditFeedEntries.lastProjectedSequence} < ${sql.raw("excluded.last_projected_sequence")}`,
      target: [auditFeedEntries.family, auditFeedEntries.familyActionId],
    });
}

async function advanceQueryActionProjectionBatch(db: DatabaseExecutor) {
  const lastCommitPosition = await loadAuditCheckpoint(db, "query_action");
  const eventRows = await loadQueryActionEventBatch(
    db,
    lastCommitPosition,
    AUDIT_PROJECTION_BATCH_SIZE
  );

  if (eventRows.length === 0) {
    return false;
  }

  const familyActionIds = [...new Set(eventRows.map((row) => row.actionId))];
  const storedRows = await loadAuditFeedRowsByActionId(
    db,
    "query_action",
    familyActionIds
  );
  const projectionRows = new Map<string, QueryActionProjectionRow>();

  for (const storedRow of storedRows) {
    try {
      projectionRows.set(
        storedRow.familyActionId,
        parseStoredQueryActionRow(storedRow)
      );
    } catch {
      projectionRows.set(
        storedRow.familyActionId,
        await rebuildQueryActionRow(
          db,
          storedRow.familyActionId,
          lastCommitPosition
        )
      );
    }
  }

  for (const eventRow of eventRows) {
    const existingRow = projectionRows.get(eventRow.actionId);
    if (existingRow === undefined) {
      const rebuiltRow =
        eventRow.sequence === 1
          ? createQueryActionRowFromStart(eventRow)
          : await rebuildQueryActionRow(
              db,
              eventRow.actionId,
              eventRow.commitPosition
            );
      projectionRows.set(eventRow.actionId, rebuiltRow);
      continue;
    }

    projectionRows.set(
      eventRow.actionId,
      reduceQueryActionRow(existingRow, eventRow)
    );
  }

  for (const projectionRow of projectionRows.values()) {
    await upsertAuditFeedRow(db, projectionRow);
  }

  const maxCommitPosition =
    eventRows[eventRows.length - 1]?.commitPosition ?? lastCommitPosition;

  await db
    .insert(auditProjectionCheckpoints)
    .values({
      family: "query_action",
      lastCommitPosition: maxCommitPosition,
      projectionName: AUDIT_FEED_PROJECTION_NAME,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      set: {
        lastCommitPosition: sql`greatest(${auditProjectionCheckpoints.lastCommitPosition}, ${maxCommitPosition})`,
        updatedAt: new Date(),
      },
      target: [
        auditProjectionCheckpoints.projectionName,
        auditProjectionCheckpoints.family,
      ],
    });

  return true;
}

async function advanceSourceApiActionProjectionBatch(db: DatabaseExecutor) {
  const lastCommitPosition = await loadAuditCheckpoint(db, "source_api_action");
  const eventRows = await loadSourceApiActionEventBatch(
    db,
    lastCommitPosition,
    AUDIT_PROJECTION_BATCH_SIZE
  );

  if (eventRows.length === 0) {
    return false;
  }

  const familyActionIds = [...new Set(eventRows.map((row) => row.actionId))];
  const storedRows = await loadAuditFeedRowsByActionId(
    db,
    "source_api_action",
    familyActionIds
  );
  const projectionRows = new Map<string, SourceApiActionProjectionRow>();

  for (const storedRow of storedRows) {
    try {
      projectionRows.set(
        storedRow.familyActionId,
        parseStoredSourceApiActionRow(storedRow)
      );
    } catch {
      projectionRows.set(
        storedRow.familyActionId,
        await rebuildSourceApiActionRow(
          db,
          storedRow.familyActionId,
          lastCommitPosition
        )
      );
    }
  }

  for (const eventRow of eventRows) {
    const existingRow = projectionRows.get(eventRow.actionId);
    if (existingRow === undefined) {
      const rebuiltRow =
        eventRow.sequence === 1
          ? createSourceApiActionRowFromStart(eventRow)
          : await rebuildSourceApiActionRow(
              db,
              eventRow.actionId,
              eventRow.commitPosition
            );
      projectionRows.set(eventRow.actionId, rebuiltRow);
      continue;
    }

    projectionRows.set(
      eventRow.actionId,
      reduceSourceApiActionRow(existingRow, eventRow)
    );
  }

  for (const projectionRow of projectionRows.values()) {
    await upsertAuditFeedRow(db, projectionRow);
  }

  const maxCommitPosition =
    eventRows[eventRows.length - 1]?.commitPosition ?? lastCommitPosition;

  await db
    .insert(auditProjectionCheckpoints)
    .values({
      family: "source_api_action",
      lastCommitPosition: maxCommitPosition,
      projectionName: AUDIT_FEED_PROJECTION_NAME,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      set: {
        lastCommitPosition: sql`greatest(${auditProjectionCheckpoints.lastCommitPosition}, ${maxCommitPosition})`,
        updatedAt: new Date(),
      },
      target: [
        auditProjectionCheckpoints.projectionName,
        auditProjectionCheckpoints.family,
      ],
    });

  return true;
}

export async function syncAuditFeedProjection(db: Database): Promise<void> {
  for (
    let batchIndex = 0;
    batchIndex < AUDIT_PROJECTION_MAX_BATCHES_PER_REQUEST;
    batchIndex += 1
  ) {
    const queryAdvanced = await db.transaction((tx) =>
      advanceQueryActionProjectionBatch(tx)
    );
    const sourceAdvanced = await db.transaction((tx) =>
      advanceSourceApiActionProjectionBatch(tx)
    );

    if (!queryAdvanced && !sourceAdvanced) {
      break;
    }
  }
}

function serializeAuditProjectedThrough(
  checkpoints: AuditProjectionCheckpointSnapshot
): AuditProjectedThrough {
  return {
    queryAction:
      checkpoints.queryAction === null
        ? null
        : checkpoints.queryAction.toString(),
    sourceApiAction:
      checkpoints.sourceApiAction === null
        ? null
        : checkpoints.sourceApiAction.toString(),
  };
}

function normalizeAuditProjectionCheckpointSnapshot(
  checkpoints: AuditProjectionCheckpointSnapshot
): AuditProjectionCheckpointPositions {
  return {
    queryAction: checkpoints.queryAction ?? 0n,
    sourceApiAction: checkpoints.sourceApiAction ?? 0n,
  };
}

async function loadAuditProjectionCheckpointSnapshot(
  db: DatabaseExecutor
): Promise<AuditProjectionCheckpointSnapshot> {
  const checkpoints: AuditProjectionCheckpointSnapshot = {
    queryAction: null,
    sourceApiAction: null,
  };
  const rows = await db
    .select({
      family: auditProjectionCheckpoints.family,
      lastCommitPosition: auditProjectionCheckpoints.lastCommitPosition,
    })
    .from(auditProjectionCheckpoints)
    .where(
      eq(auditProjectionCheckpoints.projectionName, AUDIT_FEED_PROJECTION_NAME)
    );

  for (const row of rows) {
    if (row.family === "query_action") {
      checkpoints.queryAction = row.lastCommitPosition;
      continue;
    }

    if (row.family === "source_api_action") {
      checkpoints.sourceApiAction = row.lastCommitPosition;
    }
  }

  return checkpoints;
}

async function hasUnprojectedQueryActionEvents(
  db: DatabaseExecutor,
  lastCommitPosition: bigint,
  organizationId: string
) {
  const rows = await db
    .select({ eventId: queryActionEvents.id })
    .from(queryActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, queryActionEvents.commandId)
    )
    .where(
      and(
        gt(queryActionEvents.commitPosition, lastCommitPosition),
        eq(workflowCommands.organizationId, organizationId)
      )
    )
    .limit(1);

  return rows.length > 0;
}

async function hasUnprojectedSourceApiActionEvents(
  db: DatabaseExecutor,
  lastCommitPosition: bigint,
  organizationId: string
) {
  const rows = await db
    .select({ eventId: sourceApiActionEvents.id })
    .from(sourceApiActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, sourceApiActionEvents.commandId)
    )
    .where(
      and(
        gt(sourceApiActionEvents.commitPosition, lastCommitPosition),
        eq(workflowCommands.organizationId, organizationId)
      )
    )
    .limit(1);

  return rows.length > 0;
}

async function loadAuditProjectionLag(
  db: DatabaseExecutor,
  checkpoints: AuditProjectionCheckpointPositions,
  organizationId: string
): Promise<AuditProjectionLag> {
  const [queryAction, sourceApiAction] = await Promise.all([
    hasUnprojectedQueryActionEvents(
      db,
      checkpoints.queryAction,
      organizationId
    ),
    hasUnprojectedSourceApiActionEvents(
      db,
      checkpoints.sourceApiAction,
      organizationId
    ),
  ]);

  return {
    queryAction,
    sourceApiAction,
  };
}

function serializeAuditFeedItem(row: typeof auditFeedEntries.$inferSelect) {
  const originActor = auditOriginActorSchema.parse(row.originActorJson);
  const target = auditTargetSchema.parse(row.targetJson);

  if (row.family === "query_action") {
    const preview =
      row.familyPreviewJson === null
        ? null
        : (() => {
            const storedPreview = QueryActionProjectionPreviewSchema.parse(
              row.familyPreviewJson
            );

            return auditQueryActionPreviewSchema.parse({
              elapsedMs: storedPreview.elapsedMs,
              queryText: storedPreview.queryText,
              rowCount: storedPreview.rowCount,
              usageRecordingStatus: storedPreview.usageRecordingStatus,
              validatedQuery: storedPreview.validatedQuery,
            });
          })();

    return {
      actionName:
        row.actionName === "validate" || row.actionName === "execute"
          ? row.actionName
          : (() => {
              throw new Error(
                `invalid query_action action name: ${row.actionName}`
              );
            })(),
      completedAt: row.completedAt?.toISOString() ?? null,
      failureCode:
        row.failureCode === null
          ? null
          : (row.failureCode as AuditQueryActionFailureCode),
      family: "query_action" as const,
      familyActionId: row.familyActionId,
      id: buildAuditFeedId(row.family, row.familyActionId),
      lastEventAt: row.lastEventAt.toISOString(),
      lastEventType: row.lastEventType as AuditQueryActionEventType,
      metrics:
        row.metricsJson === null
          ? null
          : auditQueryActionMetricsSchema.parse(row.metricsJson),
      originActor,
      originSurface: row.originSurface,
      outcome: row.outcome as AuditOutcome,
      phase: row.phase as AuditQueryActionPhase,
      preview,
      startedAt: row.startedAt.toISOString(),
      subtitle: row.subtitle,
      target,
      title: row.title,
    };
  }

  const preview =
    row.familyPreviewJson === null
      ? null
      : (() => {
          const storedPreview = SourceApiActionProjectionPreviewSchema.parse(
            row.familyPreviewJson
          );

          return auditSourceApiActionPreviewSchema.parse({
            attemptNumber: storedPreview.attemptNumber,
            httpStatus: storedPreview.httpStatus,
            invokeMode: storedPreview.invokeMode,
            method: storedPreview.method,
            operation: storedPreview.operation,
            pageCount: storedPreview.pageCount,
            selector: storedPreview.selector,
          });
        })();

  return {
    actionName:
      row.actionName === "describe" || row.actionName === "invoke"
        ? row.actionName
        : (() => {
            throw new Error(
              `invalid source_api_action action name: ${row.actionName}`
            );
          })(),
    completedAt: row.completedAt?.toISOString() ?? null,
    failureCode:
      row.failureCode === null
        ? null
        : (row.failureCode as AuditSourceApiActionFailureCode),
    family: "source_api_action" as const,
    familyActionId: row.familyActionId,
    id: buildAuditFeedId(row.family, row.familyActionId),
    lastEventAt: row.lastEventAt.toISOString(),
    lastEventType: row.lastEventType as AuditSourceApiActionEventType,
    metrics:
      row.metricsJson === null
        ? null
        : auditSourceApiActionMetricsSchema.parse(row.metricsJson),
    originActor,
    originSurface: row.originSurface,
    outcome: row.outcome as AuditOutcome,
    phase: row.phase as AuditSourceApiActionPhase,
    preview,
    startedAt: row.startedAt.toISOString(),
    subtitle: row.subtitle,
    target,
    title: row.title,
  };
}

export async function listAuditFeedPage(input: {
  db: Database;
  organizationId: string;
  query: AuditListQuery;
}): Promise<AuditListResponse> {
  await syncAuditFeedProjection(input.db);
  const checkpointSnapshot = await loadAuditProjectionCheckpointSnapshot(
    input.db
  );
  const projectedThrough = serializeAuditProjectedThrough(checkpointSnapshot);
  const projectionLag = await loadAuditProjectionLag(
    input.db,
    normalizeAuditProjectionCheckpointSnapshot(checkpointSnapshot),
    input.organizationId
  );
  const conditions = [
    eq(auditFeedEntries.organizationId, input.organizationId),
  ];

  if (input.query.family) {
    conditions.push(eq(auditFeedEntries.family, input.query.family));
  }

  if (input.query.actionName) {
    conditions.push(eq(auditFeedEntries.actionName, input.query.actionName));
  }

  if (input.query.outcome) {
    conditions.push(eq(auditFeedEntries.outcome, input.query.outcome));
  }

  if (input.query.sourceKey) {
    conditions.push(
      buildCaseInsensitiveEquals(
        sql`${auditFeedEntries.targetJson} ->> 'sourceKey'`,
        input.query.sourceKey
      )
    );
  }

  if (input.query.q) {
    conditions.push(
      buildCaseInsensitiveContains(
        auditFeedEntries.searchDocument,
        input.query.q
      )
    );
  }

  if (input.query.cursor) {
    const cursor = decodeAuditCursor(input.query.cursor);
    if (!cursor) {
      throw new InvalidAuditCursorError();
    }

    const cursorCondition = or(
      lt(auditFeedEntries.startedAt, cursor.startedAt),
      and(
        eq(auditFeedEntries.startedAt, cursor.startedAt),
        or(
          lt(auditFeedEntries.family, cursor.family),
          and(
            eq(auditFeedEntries.family, cursor.family),
            lt(auditFeedEntries.familyActionId, cursor.familyActionId)
          )
        )
      )
    );

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await input.db
    .select()
    .from(auditFeedEntries)
    .where(and(...conditions))
    .orderBy(
      desc(auditFeedEntries.startedAt),
      desc(auditFeedEntries.family),
      desc(auditFeedEntries.familyActionId)
    )
    .limit(input.query.limit + 1);

  const pageRows = rows.slice(0, input.query.limit);
  const lastRow = pageRows.at(-1);
  const items = pageRows.map(serializeAuditFeedItem);
  const families = [...new Set(items.map((item) => item.family))];

  return auditListResponseSchema.parse({
    families,
    items,
    nextCursor:
      rows.length > input.query.limit && lastRow
        ? encodeAuditCursor({
            family: lastRow.family,
            familyActionId: lastRow.familyActionId,
            startedAt: lastRow.startedAt,
          })
        : null,
    projectionLag,
    projectedThrough,
  });
}
