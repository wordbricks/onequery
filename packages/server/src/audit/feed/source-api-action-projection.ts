import {
  auditOriginActorSchema,
  auditSourceApiActionMetricsSchema,
  auditTargetSchema,
} from "@onequery/contracts/audit";
import type {
  AuditOutcome,
  AuditSourceApiActionEventType,
  AuditSourceApiActionFailureCode,
  AuditSourceApiActionPhase,
} from "@onequery/contracts/audit";
import type { auditFeedEntries } from "@onequery/db/server";

import { finalizeSourceApiActionRow, normalizeOriginActor } from "./read-model";
import { SourceApiActionProjectionPreviewSchema } from "./schemas";
import {
  parseSourceApiEventPayload,
  parseSourceApiStartCommand,
} from "./source-api-action-payload-codec";
import type {
  SourceApiActionEventRecord,
  SourceApiActionProjectionRow,
} from "./types";

export function createSourceApiActionRowFromStart(
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

export function reduceSourceApiActionRow(
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

export function parseStoredSourceApiActionRow(
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
