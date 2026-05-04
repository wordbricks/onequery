import type { AuditListItem } from "@onequery/audit-contracts/audit";
import { formatDateTime } from "@onequery/datetime/format-date";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onequery/ui/components/table";
import { IconChevronRight } from "@tabler/icons-react";

import {
  formatAuditEnumLabel,
  getAuditActorLabel,
  getAuditDetailLine,
  getAuditDurationLabel,
  getAuditMetricsLabel,
  getAuditOutcomeDotClassName,
  getAuditRequestIdLabel,
  getAuditTargetLabel,
  getAuditTraceIdLabel,
  getAuditVolumeLabel,
} from "./audit-display";

type AuditEntriesTableProps = {
  isDetailOpen: boolean;
  items: readonly AuditListItem[];
  onSelectItem: (item: AuditListItem) => void;
  selectedItemId: string;
};

function AuditTableRow({
  isDetailOpen,
  isSelected,
  item,
  onSelect,
}: {
  isDetailOpen: boolean;
  isSelected: boolean;
  item: AuditListItem;
  onSelect: () => void;
}) {
  const metricsLabel = getAuditMetricsLabel(item);

  return (
    <TableRow
      className={
        isSelected
          ? "border-l-blue-500 bg-blue-50/60 hover:bg-blue-50/70"
          : "border-l-transparent hover:bg-muted/40"
      }
      onClick={onSelect}
      data-state={isSelected ? "selected" : undefined}
      aria-expanded={isSelected ? isDetailOpen : undefined}
    >
      <TableCell className="w-[132px] border-l-2 py-2 align-middle">
        <div className="text-xs tabular-nums">
          {formatDateTime(item.startedAt)}
        </div>
      </TableCell>
      <TableCell className="w-[104px] py-2 align-middle">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`size-2 rounded-full ${getAuditOutcomeDotClassName(
              item.outcome
            )}`}
          />
          {formatAuditEnumLabel(item.outcome)}
        </div>
      </TableCell>
      <TableCell className="w-[172px] py-2 align-middle">
        <div className="truncate text-xs font-medium">
          {getAuditActorLabel(item)}
        </div>
      </TableCell>
      <TableCell className="w-[132px] py-2 align-middle">
        <div className="truncate text-xs">{item.target.sourceKey}</div>
      </TableCell>
      <TableCell className="min-w-[320px] py-2 align-middle">
        <div className="truncate text-xs font-medium">{item.title}</div>
        <div className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
          {getAuditDetailLine(item)}
        </div>
      </TableCell>
      <TableCell className="w-[160px] py-2 align-middle">
        <div className="truncate text-xs">{getAuditTargetLabel(item)}</div>
      </TableCell>
      <TableCell className="w-[92px] py-2 text-right align-middle text-xs tabular-nums">
        {getAuditDurationLabel(item)}
      </TableCell>
      <TableCell className="w-[112px] py-2 text-right align-middle text-xs tabular-nums">
        {getAuditVolumeLabel(item) || metricsLabel || "n/a"}
      </TableCell>
      <TableCell className="w-[152px] py-2 align-middle">
        <div
          className="text-muted-foreground truncate font-mono text-[11px]"
          title={item.requestId ?? undefined}
        >
          {getAuditRequestIdLabel(item)}
        </div>
      </TableCell>
      <TableCell className="w-[112px] py-2 align-middle">
        <div className="text-muted-foreground truncate font-mono text-[11px]">
          {getAuditTraceIdLabel(item)}
        </div>
      </TableCell>
      <TableCell className="w-8 py-2 align-middle">
        <IconChevronRight
          className={`text-muted-foreground size-4 transition-transform ${
            isSelected && isDetailOpen ? "rotate-90" : ""
          }`}
        />
      </TableCell>
    </TableRow>
  );
}

export function AuditEntriesTable({
  isDetailOpen,
  items,
  onSelectItem,
  selectedItemId,
}: AuditEntriesTableProps) {
  return (
    <section className="min-w-0 rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Audit entries</h2>
        </div>
      </div>
      <div className="max-h-[calc(100vh-240px)] overflow-auto">
        <Table className="min-w-[1372px]">
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-[132px]">Time</TableHead>
              <TableHead className="w-[104px]">Outcome</TableHead>
              <TableHead className="w-[172px]">Actor</TableHead>
              <TableHead className="w-[132px]">Source</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="w-[160px]">Target</TableHead>
              <TableHead className="w-[92px] text-right">Duration</TableHead>
              <TableHead className="w-[112px] text-right">
                Rows / Pages
              </TableHead>
              <TableHead className="w-[152px]">Request ID</TableHead>
              <TableHead className="w-[112px]">Trace ID</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <AuditTableRow
                key={item.id}
                isDetailOpen={isDetailOpen}
                isSelected={isDetailOpen && selectedItemId === item.id}
                item={item}
                onSelect={() => onSelectItem(item)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
