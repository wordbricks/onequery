import type { AuditListItem } from "@onequery/audit-contracts/audit";
import { formatDateTime } from "@onequery/datetime/format-date";

import {
  getAuditActorLabel,
  getAuditDurationLabel,
  getAuditTargetLabel,
  getAuditVolumeLabel,
} from "./audit-display";

function escapeAuditCsvValue(value: string) {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

export function buildAuditCsv(items: readonly AuditListItem[]) {
  const rows = items.map((item) => [
    formatDateTime(item.startedAt),
    item.outcome,
    getAuditActorLabel(item),
    item.target.sourceKey,
    item.title,
    getAuditTargetLabel(item),
    getAuditDurationLabel(item),
    getAuditVolumeLabel(item) || "n/a",
    item.requestId ?? "n/a",
    item.id,
  ]);

  return [
    [
      "Time",
      "Outcome",
      "Actor",
      "Source",
      "Action",
      "Target",
      "Duration",
      "Rows / Pages",
      "Request ID",
      "Trace ID",
    ],
    ...rows,
  ]
    .map((row) => row.map(escapeAuditCsvValue).join(","))
    .join("\n");
}

export function downloadAuditCsv(items: readonly AuditListItem[]) {
  const url = URL.createObjectURL(
    new Blob([buildAuditCsv(items)], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "audit-entries.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
