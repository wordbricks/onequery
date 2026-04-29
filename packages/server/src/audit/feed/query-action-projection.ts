import {
  auditOriginActorSchema,
  auditQueryActionMetricsSchema,
  auditTargetSchema,
} from "@onequery/audit-contracts/audit";
import type {
  AuditOutcome,
  AuditQueryActionEventType,
  AuditQueryActionFailureCode,
  AuditQueryActionPhase,
} from "@onequery/audit-contracts/audit";
import type { auditFeedEntries } from "@onequery/db/server";

import {
  parseQueryActionEventPayload,
  parseQueryActionStartCommand,
} from "./query-action-payload-codec";
import { finalizeQueryActionRow, normalizeOriginActor } from "./read-model";
import { QueryActionProjectionPreviewSchema } from "./schemas";
import type { QueryActionEventRecord, QueryActionProjectionRow } from "./types";

export function createQueryActionRowFromStart(
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

export function reduceQueryActionRow(
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

export function parseStoredQueryActionRow(
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
