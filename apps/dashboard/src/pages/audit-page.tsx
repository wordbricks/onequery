import {
  AUDIT_FAMILIES,
  AUDIT_OUTCOMES,
  getAuditActionNamesForFamily,
} from "@onequery/audit-contracts/audit";
import type {
  AuditActionDetail,
  AuditListItem,
  AuditListParams,
} from "@onequery/audit-contracts/audit";
import { formatDateTime } from "@onequery/datetime/format-date";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@onequery/ui/components/alert";
import { Button, buttonVariants } from "@onequery/ui/components/button";
import { CopyButton } from "@onequery/ui/components/copy-button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@onequery/ui/components/empty";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@onequery/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onequery/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@onequery/ui/components/tooltip";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconHistory,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { startTransition, useState } from "react";
import type { FormEvent } from "react";

import {
  buildAuditListParamsWithDraft,
  createAuditDraftFilters,
  getAuditDraftResetKey,
  hasPendingAuditDraftFilters,
} from "@/features/audit/audit-filter-state";
import {
  auditActionDetailQueryOptions,
  auditListQueryOptions,
} from "@/queries/audit-queries";

const routeApi = getRouteApi("/_authenticated/$org_slug/audit");

function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncateText(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function getOutcomeDotClassName(outcome: AuditListItem["outcome"]) {
  if (outcome === "succeeded") {
    return "bg-emerald-500";
  }

  if (outcome === "pending") {
    return "bg-amber-500";
  }

  return "bg-red-500";
}

function getActorLabel(item: AuditListItem) {
  return item.originActor.email ?? "System";
}

function getMetricsLabel(item: AuditListItem) {
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

function getDetailLine(item: AuditListItem) {
  if (item.family === "query_action") {
    return truncateText(item.preview?.queryText ?? item.subtitle);
  }

  const requestShape = [item.preview?.method, item.preview?.selector]
    .filter(Boolean)
    .join(" ");
  return truncateText(requestShape || item.subtitle);
}

function formatBytes(value: number | null | undefined) {
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

function getDurationLabel(item: AuditListItem) {
  if (item.family === "query_action") {
    return item.metrics?.elapsedMs ? `${item.metrics.elapsedMs} ms` : "n/a";
  }

  return item.metrics?.httpStatus ? `HTTP ${item.metrics.httpStatus}` : "n/a";
}

function getVolumeLabel(item: AuditListItem) {
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
    formatBytes(item.metrics?.responseBytes),
  ]
    .filter((part) => part && part !== "n/a")
    .join(" · ");
}

function getTargetLabel(item: AuditListItem) {
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

function getTraceIdLabel(item: AuditListItem) {
  return item.id.length > 12 ? item.id.slice(0, 12) : item.id;
}

function escapeCsvValue(value: string) {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function buildAuditCsv(items: readonly AuditListItem[]) {
  const rows = items.map((item) => [
    formatDateTime(item.startedAt),
    item.outcome,
    getActorLabel(item),
    item.target.sourceKey,
    item.title,
    getTargetLabel(item),
    getDurationLabel(item),
    getVolumeLabel(item) || "n/a",
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
      "Trace ID",
    ],
    ...rows,
  ]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
}

function downloadAuditCsv(items: readonly AuditListItem[]) {
  const url = URL.createObjectURL(
    new Blob([buildAuditCsv(items)], { type: "text/csv;charset=utf-8" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "audit-entries.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function AuditTableRow({
  isSelected,
  item,
  onSelect,
}: {
  isSelected: boolean;
  item: AuditListItem;
  onSelect: () => void;
}) {
  const metricsLabel = getMetricsLabel(item);

  return (
    <TableRow
      className={
        isSelected
          ? "border-l-blue-500 bg-blue-50/60 hover:bg-blue-50/70"
          : "border-l-transparent hover:bg-muted/40"
      }
      onClick={onSelect}
      data-state={isSelected ? "selected" : undefined}
    >
      <TableCell className="w-[132px] border-l-2 py-2 align-middle">
        <div className="text-xs tabular-nums">
          {formatDateTime(item.startedAt)}
        </div>
      </TableCell>
      <TableCell className="w-[104px] py-2 align-middle">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`size-2 rounded-full ${getOutcomeDotClassName(
              item.outcome
            )}`}
          />
          {formatEnumLabel(item.outcome)}
        </div>
      </TableCell>
      <TableCell className="w-[172px] py-2 align-middle">
        <div className="truncate text-xs font-medium">
          {getActorLabel(item)}
        </div>
      </TableCell>
      <TableCell className="w-[132px] py-2 align-middle">
        <div className="truncate text-xs">{item.target.sourceKey}</div>
      </TableCell>
      <TableCell className="min-w-[320px] py-2 align-middle">
        <div className="truncate text-xs font-medium">{item.title}</div>
        <div className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
          {getDetailLine(item)}
        </div>
      </TableCell>
      <TableCell className="w-[160px] py-2 align-middle">
        <div className="truncate text-xs">{getTargetLabel(item)}</div>
      </TableCell>
      <TableCell className="w-[92px] py-2 text-right align-middle text-xs tabular-nums">
        {getDurationLabel(item)}
      </TableCell>
      <TableCell className="w-[112px] py-2 text-right align-middle text-xs tabular-nums">
        {getVolumeLabel(item) || metricsLabel || "n/a"}
      </TableCell>
      <TableCell className="w-[112px] py-2 align-middle">
        <div className="text-muted-foreground truncate font-mono text-[11px]">
          {getTraceIdLabel(item)}
        </div>
      </TableCell>
      <TableCell className="w-8 py-2 align-middle">
        <IconChevronRight className="text-muted-foreground size-4" />
      </TableCell>
    </TableRow>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 truncate text-xs font-medium">{value}</div>
    </div>
  );
}

function EvidenceDisclosure({
  defaultOpen = false,
  title,
  value,
}: {
  defaultOpen?: boolean;
  title: string;
  value: unknown;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      className="group rounded-md border"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium">
        {title}
        <IconChevronDown
          className="text-muted-foreground size-3.5 transition-transform group-open:rotate-180"
          stroke={2}
        />
      </summary>
      <pre className="border-t p-3 text-xs break-words whitespace-pre-wrap">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function DetailSkeleton({ item }: { item: AuditListItem }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`size-2 rounded-full ${getOutcomeDotClassName(
              item.outcome
            )}`}
          />
          <span className="font-medium">{formatEnumLabel(item.outcome)}</span>
          <span className="text-muted-foreground">{item.family}</span>
        </div>
        <h2 className="mt-2 truncate text-base font-semibold">{item.title}</h2>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {item.subtitle}
        </p>
      </div>
      <div className="rounded-md border p-3 text-xs">
        Loading full command and event trace…
      </div>
    </div>
  );
}

function AuditTraceDetail({
  detail,
  item,
}: {
  detail: AuditActionDetail;
  item: AuditListItem;
}) {
  const firstCommand = detail.commands.at(0);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`size-2 rounded-full ${getOutcomeDotClassName(
                  item.outcome
                )}`}
              />
              <span className="font-medium">
                {formatEnumLabel(item.outcome)}
              </span>
              <span className="text-muted-foreground">
                {formatDateTime(item.startedAt)}
              </span>
            </div>
            <h2 className="mt-2 truncate text-base font-semibold">
              {item.title}
            </h2>
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {item.subtitle}
            </p>
          </div>
          <CopyButton value={item.id} className="size-7 shrink-0" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3">
        <DetailFact label="Actor" value={getActorLabel(item)} />
        <DetailFact label="Source" value={item.target.sourceKey} />
        <DetailFact label="Duration" value={getDurationLabel(item)} />
        <DetailFact
          label="Rows / Pages"
          value={getVolumeLabel(item) || "n/a"}
        />
        <DetailFact label="Phase" value={formatEnumLabel(item.phase)} />
        <DetailFact label="Action" value={formatEnumLabel(item.actionName)} />
        <DetailFact
          label="Last event"
          value={formatEnumLabel(item.lastEventType)}
        />
        <DetailFact
          label="Failure"
          value={item.failureCode ? formatEnumLabel(item.failureCode) : "n/a"}
        />
        <DetailFact label="Trace ID" value={getTraceIdLabel(item)} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Event timeline</h3>
          <span className="text-muted-foreground text-xs">
            {detail.events.length} events
          </span>
        </div>
        <div className="divide-y rounded-md border">
          {detail.events.map((event) => (
            <div
              key={event.id}
              className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 px-3 py-2"
            >
              <div className="bg-muted flex size-6 items-center justify-center rounded-full text-[11px] tabular-nums">
                {event.sequence}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">
                    {formatEnumLabel(event.eventType)}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    {formatBytes(event.payload.byteLength)}
                  </span>
                </div>
                <div className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
                  {formatDateTime(event.occurredAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {detail.family === "query_action" ? (
        <div className="grid gap-2">
          {item.family === "query_action" && item.preview?.errorDetail ? (
            <EvidenceDisclosure
              defaultOpen
              title="Failure detail"
              value={{
                detail: item.preview.errorDetail,
                failureCode: item.failureCode,
                hint: item.preview.errorHint,
                lastEventType: item.lastEventType,
              }}
            />
          ) : null}
          <EvidenceDisclosure
            defaultOpen
            title="SQL"
            value={detail.action.queryText}
          />
          <EvidenceDisclosure
            title="Validated query"
            value={
              detail.action.validatedQuery ?? "No validated query recorded"
            }
          />
          <EvidenceDisclosure
            title="Metrics"
            value={item.metrics ?? "No metrics recorded"}
          />
          <EvidenceDisclosure
            title="Usage recording"
            value={detail.action.usageRecordingStatus}
          />
          <EvidenceDisclosure
            title="Source descriptor"
            value={detail.action.sourceDescriptor}
          />
        </div>
      ) : (
        <div className="grid gap-2">
          {item.family === "source_api_action" && item.preview?.errorDetail ? (
            <EvidenceDisclosure
              defaultOpen
              title="Failure detail"
              value={{
                detail: item.preview.errorDetail,
                failureCode: item.failureCode,
                lastEventType: item.lastEventType,
              }}
            />
          ) : null}
          <EvidenceDisclosure
            defaultOpen
            title="Request"
            value={detail.action.requestDescriptor}
          />
          <EvidenceDisclosure
            title="Payload"
            value={detail.action.pageProgress}
          />
          <EvidenceDisclosure
            title="Metrics"
            value={item.metrics ?? "No metrics recorded"}
          />
          <EvidenceDisclosure
            title="Source descriptor"
            value={detail.action.sourceDescriptor}
          />
        </div>
      )}

      <div className="grid gap-2">
        <EvidenceDisclosure
          title="Command payload"
          value={firstCommand?.decodedPayload ?? null}
        />
        <EvidenceDisclosure
          title="Raw Events"
          value={detail.events.map((event) => ({
            commandId: event.commandId,
            eventType: event.eventType,
            id: event.id,
            payload: event.decodedPayload,
            sequence: event.sequence,
          }))}
        />
      </div>
    </div>
  );
}

function formatLabelList(values: readonly string[]) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0] ?? "";
  }

  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function getLaggingAuditFamilyLabels(
  search: Pick<AuditListParams, "family">,
  projectionLag: {
    queryAction: boolean;
    sourceApiAction: boolean;
  }
) {
  const relevantFamilies = search.family ? [search.family] : AUDIT_FAMILIES;

  return relevantFamilies
    .filter((family) =>
      family === "query_action"
        ? projectionLag.queryAction
        : projectionLag.sourceApiAction
    )
    .map(formatEnumLabel);
}

function AuditFiltersSection({
  isFetching,
  itemCount,
  nextCursor,
  organizationSlug,
  projectionLag,
  search,
}: {
  isFetching: boolean;
  itemCount: number;
  nextCursor: string | null;
  organizationSlug: string;
  projectionLag: {
    queryAction: boolean;
    sourceApiAction: boolean;
  };
  search: AuditListParams;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => createAuditDraftFilters(search));
  const hasPendingDraftFilters = hasPendingAuditDraftFilters(search, draft);
  const actionNames = getAuditActionNamesForFamily(search.family);
  const laggingFamilyLabels = getLaggingAuditFamilyLabels(
    search,
    projectionLag
  );

  function navigateAuditListParams(next: Partial<AuditListParams>) {
    startTransition(() => {
      void navigate({
        params: { org_slug: organizationSlug },
        replace: true,
        search: buildAuditListParamsWithDraft(search, draft, next),
        to: "/$org_slug/audit",
      });
    });
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateAuditListParams({ cursor: undefined });
  }

  function handleClearFilters() {
    setDraft({
      q: "",
      sourceKey: "",
    });

    startTransition(() => {
      void navigate({
        params: { org_slug: organizationSlug },
        replace: true,
        search: {
          limit: search.limit,
        },
        to: "/$org_slug/audit",
      });
    });
  }

  return (
    <section className="border-b pb-4">
      <form
        className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_160px_360px_150px_150px_auto]"
        onSubmit={handleFilterSubmit}
      >
        <div className="relative">
          <Label htmlFor="audit-search" className="sr-only">
            Search
          </Label>
          <IconSearch
            className="text-muted-foreground absolute top-2 left-2.5 size-4"
            stroke={2}
          />
          <Input
            id="audit-search"
            className="pl-8"
            value={draft.q}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                q: event.target.value,
              }))
            }
            placeholder="Search actor, source, query"
          />
        </div>

        <div>
          <Label htmlFor="audit-source-key" className="sr-only">
            Source
          </Label>
          <Input
            id="audit-source-key"
            value={draft.sourceKey}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sourceKey: event.target.value,
              }))
            }
            placeholder="Source"
          />
        </div>

        <div className="flex rounded-lg border p-0.5">
          <Button
            type="button"
            variant={search.outcome ? "ghost" : "secondary"}
            size="sm"
            className="flex-1"
            onClick={() =>
              navigateAuditListParams({ cursor: undefined, outcome: undefined })
            }
          >
            All outcomes
          </Button>
          {AUDIT_OUTCOMES.map((outcome) => (
            <Button
              key={outcome}
              type="button"
              variant={search.outcome === outcome ? "secondary" : "ghost"}
              size="sm"
              className="flex-1"
              onClick={() =>
                navigateAuditListParams({
                  cursor: undefined,
                  outcome,
                })
              }
            >
              <span
                className={`size-1.5 rounded-full ${getOutcomeDotClassName(
                  outcome
                )}`}
              />
              {formatEnumLabel(outcome)}
            </Button>
          ))}
        </div>

        <div>
          <Label htmlFor="audit-family" className="sr-only">
            Family
          </Label>
          <Select
            value={search.family ?? "all"}
            onValueChange={(value) => {
              navigateAuditListParams({
                cursor: undefined,
                family:
                  value && value !== "all"
                    ? (value as AuditListParams["family"])
                    : undefined,
              });
            }}
          >
            <SelectTrigger id="audit-family" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All families</SelectItem>
              {AUDIT_FAMILIES.map((family) => (
                <SelectItem key={family} value={family}>
                  {formatEnumLabel(family)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="audit-action-name" className="sr-only">
            Action
          </Label>
          <Select
            value={search.actionName ?? "all"}
            onValueChange={(value) => {
              navigateAuditListParams({
                actionName:
                  value && value !== "all"
                    ? (value as AuditListParams["actionName"])
                    : undefined,
                cursor: undefined,
              });
            }}
          >
            <SelectTrigger id="audit-action-name" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actionNames.map((actionName) => (
                <SelectItem key={actionName} value={actionName}>
                  {formatEnumLabel(actionName)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button
            type="submit"
            className="w-full lg:w-auto"
            disabled={!hasPendingDraftFilters}
          >
            Apply
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full lg:w-auto"
            onClick={handleClearFilters}
          >
            Clear
          </Button>
        </div>
      </form>

      {laggingFamilyLabels.length > 0 ? (
        <Alert className="mt-4 border-amber-300/60 bg-amber-50/80 text-amber-950">
          <IconAlertTriangle className="size-4" />
          <AlertTitle>Audit feed is still catching up</AlertTitle>
          <AlertDescription>
            Recent {formatLabelList(laggingFamilyLabels)} events may not appear
            yet. This page will refresh while the feed catches up.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          {itemCount} entries on this page
          {search.cursor ? " · viewing older results" : " · newest first"}
          {hasPendingDraftFilters ? " · apply search filters to paginate" : ""}
          {isFetching ? " · updating" : ""}
        </p>

        <div className="flex items-center gap-2">
          {search.cursor ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => navigateAuditListParams({ cursor: undefined })}
            >
              <IconArrowLeft size={16} stroke={2} />
              Newest
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!nextCursor || hasPendingDraftFilters) {
                return;
              }

              navigateAuditListParams({ cursor: nextCursor });
            }}
            // Comment: Audit cursors are tied to the exact applied URL filters,
            // so the current page token cannot be reused once the text-filter
            // draft diverges from the route search.
            disabled={!nextCursor || hasPendingDraftFilters}
          >
            Older
            <IconArrowRight size={16} stroke={2} />
          </Button>
        </div>
      </div>
    </section>
  );
}

export function AuditPage() {
  const { organizationSlug, session } = routeApi.useRouteContext();
  const search = routeApi.useSearch();
  const { data, isFetching, refetch } = useSuspenseQuery(
    auditListQueryOptions(session.user.id, organizationSlug, search)
  );
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(
    () => data.items[0]?.id ?? null
  );
  const selectedItem =
    data.items.find((item) => item.id === selectedAuditId) ??
    data.items[0] ??
    null;
  const selectedFamily = selectedItem?.family ?? "query_action";
  const selectedActionId = selectedItem?.familyActionId ?? "__none__";
  const detailQuery = useQuery({
    ...auditActionDetailQueryOptions(
      session.user.id,
      organizationSlug,
      selectedFamily,
      selectedActionId
    ),
    enabled: selectedItem !== null,
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Audit</h1>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              aria-label="Refresh audit feed"
              className={buttonVariants({ size: "icon", variant: "outline" })}
              disabled={isFetching}
              onClick={() => {
                void refetch();
              }}
              type="button"
            >
              <IconRefresh
                className={isFetching ? "animate-spin" : undefined}
                size={16}
                stroke={2}
              />
            </TooltipTrigger>
            <TooltipContent>Refresh audit feed</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={data.items.length === 0}
            onClick={() => downloadAuditCsv(data.items)}
          >
            <IconDownload size={16} stroke={2} />
            Export
          </Button>
        </div>
      </div>

      <AuditFiltersSection
        key={getAuditDraftResetKey(search)}
        isFetching={isFetching}
        itemCount={data.items.length}
        nextCursor={data.nextCursor}
        organizationSlug={organizationSlug}
        projectionLag={data.projectionLag}
        search={search}
      />

      {data.items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconHistory size={18} stroke={1.75} />
            </EmptyMedia>
            <EmptyTitle>No audit entries matched these filters</EmptyTitle>
            <EmptyDescription>
              Try clearing the filters or waiting for new workflow activity in
              this organization.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <section className="min-w-0 rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div>
                <h2 className="text-sm font-semibold">Audit entries</h2>
              </div>
            </div>
            <div className="max-h-[calc(100vh-240px)] overflow-auto">
              <Table className="min-w-[1220px]">
                <TableHeader className="bg-background sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="w-[132px]">Time</TableHead>
                    <TableHead className="w-[104px]">Outcome</TableHead>
                    <TableHead className="w-[172px]">Actor</TableHead>
                    <TableHead className="w-[132px]">Source</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="w-[160px]">Target</TableHead>
                    <TableHead className="w-[92px] text-right">
                      Duration
                    </TableHead>
                    <TableHead className="w-[112px] text-right">
                      Rows / Pages
                    </TableHead>
                    <TableHead className="w-[112px]">Trace ID</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <AuditTableRow
                      key={item.id}
                      isSelected={selectedItem?.id === item.id}
                      item={item}
                      onSelect={() => setSelectedAuditId(item.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <aside className="min-w-0 rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div>
                <h2 className="text-sm font-semibold">Details</h2>
              </div>
            </div>
            <div className="max-h-[calc(100vh-240px)] overflow-auto p-3">
              {selectedItem && detailQuery.isPending ? (
                <DetailSkeleton item={selectedItem} />
              ) : null}
              {selectedItem && detailQuery.isError ? (
                <div className="space-y-4">
                  <DetailSkeleton item={selectedItem} />
                  <Alert variant="destructive">
                    <IconAlertTriangle className="size-4" />
                    <AlertTitle>Failed to load trace detail</AlertTitle>
                    <AlertDescription>
                      {detailQuery.error.message}
                    </AlertDescription>
                  </Alert>
                </div>
              ) : null}
              {selectedItem && detailQuery.data ? (
                <AuditTraceDetail
                  key={selectedItem.id}
                  detail={detailQuery.data}
                  item={selectedItem}
                />
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
