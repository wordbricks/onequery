import { AUDIT_FAMILIES } from "@onequery/audit-contracts/audit";
import type {
  AuditOutcome,
  AuditListItem,
  AuditListParams,
  AuditProjectionLag,
} from "@onequery/audit-contracts/audit";

export function formatAuditEnumLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateAuditText(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

export const AUDIT_OUTCOME_DOT_CLASS_NAMES = {
  failed: "bg-red-500",
  pending: "bg-amber-500",
  succeeded: "bg-emerald-500",
} satisfies Record<AuditOutcome, string>;

export function getAuditActorLabel(item: AuditListItem) {
  return item.originActor.email ?? "System";
}

export function getAuditMetricsLabel(item: AuditListItem) {
  if (item.family === "query_action") {
    const elapsedLabel =
      item.metrics?.elapsedMs !== null && item.metrics?.elapsedMs !== undefined
        ? `${item.metrics.elapsedMs} ms`
        : null;
    const rowCountLabel =
      item.metrics?.rowCount !== null && item.metrics?.rowCount !== undefined
        ? `${item.metrics.rowCount} rows`
        : null;

    return [elapsedLabel, rowCountLabel].filter(Boolean).join(" · ");
  }

  const pageCountLabel =
    item.metrics?.pageCount !== null && item.metrics?.pageCount !== undefined
      ? `${item.metrics.pageCount} pages`
      : null;
  const statusLabel =
    item.metrics?.httpStatus !== null && item.metrics?.httpStatus !== undefined
      ? `HTTP ${item.metrics.httpStatus}`
      : null;

  return [pageCountLabel, statusLabel].filter(Boolean).join(" · ");
}

export function getAuditDetailLine(item: AuditListItem) {
  if (item.family === "query_action") {
    return truncateAuditText(item.preview?.queryText ?? item.subtitle);
  }

  const requestShape = [item.preview?.method, item.preview?.selector]
    .filter(Boolean)
    .join(" ");
  return truncateAuditText(requestShape || item.subtitle);
}

export function formatAuditBytes(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function getAuditDurationLabel(item: AuditListItem) {
  if (item.family === "query_action") {
    // Comment: The old audit page rendered zero elapsed time as "n/a"; keep
    // that behavior until zero-duration rows get an explicit product decision.
    return item.metrics?.elapsedMs ? `${item.metrics.elapsedMs} ms` : "n/a";
  }

  return item.metrics?.httpStatus ? `HTTP ${item.metrics.httpStatus}` : "n/a";
}

export function getAuditVolumeLabel(item: AuditListItem) {
  if (item.family === "query_action") {
    return item.metrics?.rowCount !== null &&
      item.metrics?.rowCount !== undefined
      ? `${item.metrics.rowCount.toLocaleString()} rows`
      : "n/a";
  }

  return [
    item.metrics?.pageCount !== null && item.metrics?.pageCount !== undefined
      ? `${item.metrics.pageCount} pages`
      : null,
    formatAuditBytes(item.metrics?.responseBytes),
  ]
    .filter((part) => part && part !== "n/a")
    .join(" · ");
}

export function getAuditTargetLabel(item: AuditListItem) {
  if (item.family === "source_api_action") {
    return (
      item.preview?.operation ??
      item.preview?.selector ??
      item.preview?.method ??
      item.target.displayName ??
      item.target.sourceName ??
      "API"
    );
  }

  return (
    item.target.displayName ??
    item.target.sourceName ??
    item.target.provider ??
    "Query"
  );
}

export function getAuditTraceIdLabel(item: AuditListItem) {
  return item.id.length > 12 ? item.id.slice(0, 12) : item.id;
}

export function getAuditRequestIdLabel(item: AuditListItem) {
  if (!item.requestId) {
    return "n/a";
  }

  return item.requestId.length > 18
    ? `${item.requestId.slice(0, 17)}…`
    : item.requestId;
}

function formatAuditLabelList(values: readonly string[]) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0] ?? "";
  }

  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

export function getLaggingAuditFamilyLabel(input: {
  projectionLag: AuditProjectionLag;
  search: Pick<AuditListParams, "family">;
}) {
  const relevantFamilies = input.search.family
    ? [input.search.family]
    : AUDIT_FAMILIES;
  const laggingFamilies = relevantFamilies
    .filter((family) =>
      family === "query_action"
        ? input.projectionLag.queryAction
        : input.projectionLag.sourceApiAction
    )
    .map(formatAuditEnumLabel);

  return formatAuditLabelList(laggingFamilies);
}
