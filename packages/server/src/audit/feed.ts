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
  Database,
  WorkflowActorSnapshotJson,
  WorkflowFamily,
  WorkflowJson,
  WorkflowSurface,
} from "@onequery/db/server";
import { z } from "zod";

const AUDIT_FEED_PROJECTION_NAME = "audit_feed_entries";
const AUDIT_PROJECTION_BATCH_SIZE = 200;
const AUDIT_PROJECTION_MAX_BATCHES_PER_REQUEST = 5;

const QueryActionStartCommandPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      queryText: z.string(),
      sourceKey: z.string(),
      type: z.literal("start_validate"),
    })
    .strict(),
  z
    .object({
      queryText: z.string(),
      sourceKey: z.string(),
      type: z.literal("start_execute"),
    })
    .strict(),
]);

const QueryActionSourceDescriptorSchema = z
  .object({
    displayName: z.string().nullable(),
    name: z.string(),
    organizationId: z.string(),
    provider: z.string(),
    sourceId: z.string(),
    sourceKey: z.string(),
    sourceStatus: z.string(),
  })
  .strict();

const QueryActionEventPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      queryMode: z.enum(["validate", "execute"]),
      queryText: z.string(),
      type: z.literal("action_received"),
    })
    .strict(),
  z
    .object({
      source: QueryActionSourceDescriptorSchema,
      type: z.literal("source_loaded"),
    })
    .strict(),
  z
    .object({
      sourceKey: z.string(),
      type: z.literal("source_not_found"),
    })
    .strict(),
  z
    .object({
      provider: z.string(),
      sourceStatus: z.string(),
      type: z.literal("source_not_queryable"),
    })
    .strict(),
  z
    .object({
      type: z.literal("query_validated"),
      validatedQuery: z.string(),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string().optional(),
      type: z.literal("query_rejected"),
    })
    .strict(),
  z
    .object({
      type: z.literal("credentials_loaded"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      hint: z.string(),
      type: z.literal("query_preparation_failed"),
    })
    .strict(),
  z
    .object({
      elapsedMs: z.number().int(),
      rowCount: z.number().int(),
      type: z.literal("query_executed"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_unavailable"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_timed_out"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("query_execution_failed"),
    })
    .strict(),
  z
    .object({
      type: z.literal("usage_persisted"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      type: z.literal("usage_persist_failed"),
    })
    .strict(),
]);

const SourceApiRequestDescriptorSchema = z
  .object({
    descriptorVersion: z.string().nullable(),
    kind: z.string().nullable(),
    method: z.string().nullable(),
    operation: z.string(),
    paginationPolicy: z.string().nullable(),
    selector: z.string().nullable(),
  })
  .strict();

const SourceApiStartCommandPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      sourceKey: z.string(),
      type: z.literal("start_describe"),
    })
    .strict(),
  z
    .object({
      invokeMode: z.enum(["preview_only", "execute"]),
      requestDescriptor: SourceApiRequestDescriptorSchema,
      sourceKey: z.string(),
      type: z.literal("start_invoke"),
    })
    .strict(),
]);

const SourceApiSourceDescriptorSchema = z
  .object({
    displayName: z.string().nullable(),
    provider: z.string(),
    sourceId: z.string(),
    sourceKey: z.string(),
  })
  .strict();

const SourceApiEventPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      invokeMode: z.enum(["preview_only", "execute"]).nullable(),
      requestDescriptor: SourceApiRequestDescriptorSchema.nullable(),
      requestKind: z.enum(["describe", "invoke"]),
      type: z.literal("action_received"),
    })
    .strict(),
  z
    .object({
      source: SourceApiSourceDescriptorSchema,
      type: z.literal("source_loaded"),
    })
    .strict(),
  z
    .object({
      sourceKey: z.string(),
      type: z.literal("source_not_found"),
    })
    .strict(),
  z
    .object({
      requestDescriptor: SourceApiRequestDescriptorSchema.nullable(),
      type: z.literal("descriptor_resolved"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      failureCode: z.enum(["descriptor_unavailable", "permission_denied"]),
      type: z.literal("descriptor_resolution_failed"),
    })
    .strict(),
  z
    .object({
      preparedRequestFingerprint: z.string(),
      type: z.literal("request_prepared"),
    })
    .strict(),
  z
    .object({
      detail: z.string(),
      failureCode: z.enum(["invalid_request", "permission_denied"]),
      type: z.literal("request_preparation_failed"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      type: z.literal("resume_requested"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      contentType: z.string().nullable(),
      hasContinuation: z.boolean(),
      httpStatus: z.number().int(),
      pageIndex: z.number().int(),
      responseBytes: z.number().int().nullable(),
      type: z.literal("page_fetch_succeeded"),
    })
    .strict(),
  z
    .object({
      attemptNumber: z.number().int(),
      detail: z.string(),
      failureCode: z
        .enum([
          "request_failed",
          "request_timed_out",
          "execution_failed",
          "execution_state_invalid",
        ])
        .nullable(),
      kind: z.enum(["retryable_failure", "terminal_failure"]),
      pageIndex: z.number().int(),
      type: z.literal("page_fetch_failed"),
    })
    .strict(),
]);

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

type AuditFeedCheckpointMap = {
  queryAction: string | null;
  sourceApiAction: string | null;
};

type AuditFeedCheckpointPositionMap = {
  queryAction: bigint | null;
  sourceApiAction: bigint | null;
};

type AuditProjectionState = {
  projectedThrough: AuditFeedCheckpointMap;
  projectionLag: AuditProjectionLag;
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
  commandPayloadJson: WorkflowJson;
  commitPosition: bigint;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  organizationId: string;
  payloadJson: WorkflowJson;
  sequence: number;
  surface: WorkflowSurface;
};

type SourceApiActionEventRecord = {
  actionId: string;
  actorSnapshotJson: WorkflowActorSnapshotJson;
  commandPayloadJson: WorkflowJson;
  commitPosition: bigint;
  eventId: string;
  eventType: string;
  occurredAt: Date;
  organizationId: string;
  payloadJson: WorkflowJson;
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
  const payload = QueryActionEventPayloadSchema.parse(record.payloadJson);
  if (payload.type !== "action_received") {
    throw new Error(
      `query_action ${record.actionId} projection started from ${payload.type}`
    );
  }

  const startCommand = QueryActionStartCommandPayloadSchema.parse(
    record.commandPayloadJson
  );
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

  const payload = QueryActionEventPayloadSchema.parse(record.payloadJson);
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
      next.preview.errorHint = payload.hint ?? null;
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
  const payload = SourceApiEventPayloadSchema.parse(record.payloadJson);
  if (payload.type !== "action_received") {
    throw new Error(
      `source_api_action ${record.actionId} projection started from ${payload.type}`
    );
  }

  const startCommand = SourceApiStartCommandPayloadSchema.parse(
    record.commandPayloadJson
  );
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

  const payload = SourceApiEventPayloadSchema.parse(record.payloadJson);
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
      if (payload.kind === "retryable_failure") {
        next.completedAt = null;
        next.failureCode = null;
        next.outcome = "pending";
        next.phase = "await_resume";
      } else {
        next.completedAt = record.occurredAt;
        next.failureCode = payload.failureCode;
        next.outcome = "failed";
        next.phase = "completed";
      }
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
    completedAt: row.completedAt ?? null,
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
    completedAt: row.completedAt ?? null,
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
      commandPayloadJson: workflowCommands.commandPayloadJson,
      commitPosition: queryActionEvents.commitPosition,
      eventId: queryActionEvents.id,
      eventType: queryActionEvents.eventType,
      occurredAt: queryActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadJson: queryActionEvents.payloadJson,
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
      commandPayloadJson: workflowCommands.commandPayloadJson,
      commitPosition: sourceApiActionEvents.commitPosition,
      eventId: sourceApiActionEvents.id,
      eventType: sourceApiActionEvents.eventType,
      occurredAt: sourceApiActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadJson: sourceApiActionEvents.payloadJson,
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
      commandPayloadJson: workflowCommands.commandPayloadJson,
      commitPosition: queryActionEvents.commitPosition,
      eventId: queryActionEvents.id,
      eventType: queryActionEvents.eventType,
      occurredAt: queryActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadJson: queryActionEvents.payloadJson,
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
      commandPayloadJson: workflowCommands.commandPayloadJson,
      commitPosition: sourceApiActionEvents.commitPosition,
      eventId: sourceApiActionEvents.id,
      eventType: sourceApiActionEvents.eventType,
      occurredAt: sourceApiActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadJson: sourceApiActionEvents.payloadJson,
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
  const previewJson = row.preview as WorkflowJson;
  const metricsJson = row.metrics as WorkflowJson | null;

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
      originActorJson: row.originActor as WorkflowJson,
      originSurface: row.originSurface,
      outcome: row.outcome,
      phase: row.phase,
      searchDocument: row.searchDocument,
      startedAt: row.startedAt,
      subtitle: row.subtitle,
      targetJson: row.target as WorkflowJson,
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
        originActorJson: row.originActor as WorkflowJson,
        originSurface: row.originSurface,
        outcome: row.outcome,
        phase: row.phase,
        searchDocument: row.searchDocument,
        startedAt: row.startedAt,
        subtitle: row.subtitle,
        targetJson: row.target as WorkflowJson,
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

export async function syncAuditFeedProjection(
  db: Database
): Promise<AuditProjectionState> {
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

  return loadAuditProjectionState(db);
}

function serializeAuditProjectedThrough(
  checkpoints: AuditFeedCheckpointPositionMap
): AuditFeedCheckpointMap {
  return {
    queryAction: checkpoints.queryAction?.toString() ?? null,
    sourceApiAction: checkpoints.sourceApiAction?.toString() ?? null,
  };
}

async function loadAuditProjectionCheckpointPositions(
  db: DatabaseExecutor
): Promise<AuditFeedCheckpointPositionMap> {
  const checkpoints: AuditFeedCheckpointPositionMap = {
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
  lastCommitPosition: bigint | null
) {
  const rows = await loadQueryActionEventBatch(db, lastCommitPosition ?? 0n, 1);
  return rows.length > 0;
}

async function hasUnprojectedSourceApiActionEvents(
  db: DatabaseExecutor,
  lastCommitPosition: bigint | null
) {
  const rows = await loadSourceApiActionEventBatch(
    db,
    lastCommitPosition ?? 0n,
    1
  );
  return rows.length > 0;
}

async function loadAuditProjectionLag(
  db: DatabaseExecutor,
  checkpoints: AuditFeedCheckpointPositionMap
): Promise<AuditProjectionLag> {
  const queryAction = await hasUnprojectedQueryActionEvents(
    db,
    checkpoints.queryAction
  );
  const sourceApiAction = await hasUnprojectedSourceApiActionEvents(
    db,
    checkpoints.sourceApiAction
  );

  return {
    queryAction,
    sourceApiAction,
  };
}

async function loadAuditProjectionState(
  db: DatabaseExecutor
): Promise<AuditProjectionState> {
  const checkpoints = await loadAuditProjectionCheckpointPositions(db);

  return {
    projectedThrough: serializeAuditProjectedThrough(checkpoints),
    projectionLag: await loadAuditProjectionLag(db, checkpoints),
  };
}

export async function loadAuditProjectedThrough(
  db: DatabaseExecutor
): Promise<AuditFeedCheckpointMap> {
  const checkpoints = await loadAuditProjectionCheckpointPositions(db);
  return serializeAuditProjectedThrough(checkpoints);
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
  const { projectedThrough, projectionLag } = await syncAuditFeedProjection(
    input.db
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
