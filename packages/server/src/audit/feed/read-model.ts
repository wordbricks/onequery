import { auditOriginActorSchema } from "@onequery/contracts/audit";
import type {
  AuditOriginActor,
  AuditQueryActionMetrics,
  AuditSourceApiActionMetrics,
} from "@onequery/contracts/audit";
import type { WorkflowActorSnapshotJson } from "@onequery/db/server";

import type {
  QueryActionProjectionPreview,
  SourceApiActionProjectionPreview,
} from "./schemas";
import type {
  QueryActionProjectionRow,
  QueryActionProjectionRowCore,
  SourceApiActionProjectionRow,
  SourceApiActionProjectionRowCore,
} from "./types";

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

export function normalizeOriginActor(
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

export function finalizeQueryActionRow(
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

export function finalizeSourceApiActionRow(
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
