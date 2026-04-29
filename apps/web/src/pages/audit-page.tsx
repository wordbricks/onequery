import {
  AUDIT_FAMILIES,
  AUDIT_OUTCOMES,
  getAuditActionNamesForFamily,
} from "@onequery/audit-contracts/audit";
import { formatDateTime } from "@onequery/datetime/format-date";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@onequery/ui/components/alert";
import { Badge } from "@onequery/ui/components/badge";
import { Button, buttonVariants } from "@onequery/ui/components/button";
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
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconHistory,
  IconListDetails,
  IconRefresh,
  IconRoute,
} from "@tabler/icons-react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { startTransition, useState } from "react";
import type { FormEvent } from "react";

import {
  buildAuditSearchWithDraft,
  createAuditDraftFilters,
  getAuditDraftResetKey,
  hasPendingAuditDraftFilters,
} from "@/features/audit/audit-filter-state";
import {
  auditActionDetailQueryOptions,
  auditListQueryOptions,
} from "@/queries/audit-queries";
import type {
  AuditActionDetail,
  AuditListItem,
  AuditSearch,
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

function getOutcomeBadgeVariant(outcome: AuditListItem["outcome"]) {
  if (outcome === "succeeded") {
    return "secondary" as const;
  }

  if (outcome === "pending") {
    return "outline" as const;
  }

  return "destructive" as const;
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
        isSelected ? "bg-muted/60 hover:bg-muted/60" : "hover:bg-muted/40"
      }
      onClick={onSelect}
    >
      <TableCell className="w-[132px] align-top">
        <div className="text-xs font-medium">
          {formatDateTime(item.startedAt)}
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          {formatEnumLabel(item.originSurface)}
        </div>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="max-w-[180px] truncate text-sm font-medium">
          {getActorLabel(item)}
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          {item.target.sourceKey}
        </div>
      </TableCell>
      <TableCell className="min-w-[340px] align-top whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{formatEnumLabel(item.family)}</Badge>
          <span className="text-sm font-medium">{item.title}</span>
        </div>
        <div className="text-muted-foreground mt-2 text-xs font-mono break-words">
          {getDetailLine(item)}
        </div>
      </TableCell>
      <TableCell className="w-[132px] align-top whitespace-normal">
        <div className="flex flex-col gap-2">
          <Badge variant={getOutcomeBadgeVariant(item.outcome)}>
            {formatEnumLabel(item.outcome)}
          </Badge>
          <div className="text-muted-foreground text-xs">
            {formatEnumLabel(item.phase)}
          </div>
          {metricsLabel ? (
            <div className="text-muted-foreground text-xs">{metricsLabel}</div>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="w-8 align-top">
        <IconChevronRight className="text-muted-foreground size-4" />
      </TableCell>
    </TableRow>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-md border">
      <div className="border-b px-3 py-2 text-xs font-medium">{title}</div>
      <pre className="max-h-44 overflow-auto p-3 text-xs">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function DetailSkeleton({ item }: { item: AuditListItem }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Badge variant={getOutcomeBadgeVariant(item.outcome)}>
            {formatEnumLabel(item.outcome)}
          </Badge>
          <Badge variant="outline">{item.family}</Badge>
        </div>
        <h2 className="mt-3 text-xl font-semibold">{item.title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{item.subtitle}</p>
      </div>
      <div className="rounded-md border p-4 text-sm">
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
  const latestEvent = detail.events.at(-1);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={getOutcomeBadgeVariant(item.outcome)}>
            {formatEnumLabel(item.outcome)}
          </Badge>
          <Badge variant="outline">{detail.family}</Badge>
          <Badge variant="secondary">Projection caught up</Badge>
        </div>
        <h2 className="mt-3 text-xl font-semibold">
          {detail.family === "query_action" ? "Query trace" : "API trace"}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{item.subtitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Duration" value={getDurationLabel(item)} />
        <StatTile label="Volume" value={getVolumeLabel(item) || "n/a"} />
        <StatTile label="Source" value={item.target.sourceKey} />
        <StatTile label="Actor" value={getActorLabel(item)} />
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="text-muted-foreground text-xs">workflow_commands</div>
          <div className="mt-1 font-mono text-xs break-all">
            {firstCommand?.id ?? "No command recorded"}
          </div>
          <div className="text-muted-foreground mt-2 text-xs">
            Request {firstCommand?.requestId ?? "n/a"}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-muted-foreground text-xs">Last event</div>
          <div className="mt-1 font-mono text-xs break-all">
            {latestEvent?.eventType ?? item.lastEventType}
          </div>
          <div className="text-muted-foreground mt-2 text-xs">
            commit_position {latestEvent?.commitPosition ?? "n/a"}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          {["Timeline", "SQL", "Payload", "Metrics", "Events"].map(
            (tab, index) => (
              <Button
                key={tab}
                type="button"
                variant={index === 0 ? "secondary" : "outline"}
                size="sm"
              >
                {tab}
              </Button>
            )
          )}
        </div>

        <div className="space-y-3">
          {detail.events.map((event) => (
            <div
              key={event.id}
              className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-md border p-3"
            >
              <div className="bg-muted flex size-8 items-center justify-center rounded-full text-xs font-medium">
                {event.sequence}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {formatEnumLabel(event.eventType)}
                  </span>
                  <Badge variant="outline">
                    commit_position {event.commitPosition}
                  </Badge>
                  <Badge variant="outline">
                    {formatBytes(event.payload.byteLength)}
                  </Badge>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {formatDateTime(event.occurredAt)} · command {event.commandId}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {detail.family === "query_action" ? (
        <div className="grid gap-3">
          <JsonBlock title="query_text" value={detail.action.queryText} />
          <JsonBlock
            title="validated_query"
            value={
              detail.action.validatedQuery ?? "No validated query recorded"
            }
          />
          <JsonBlock
            title="source_descriptor_json"
            value={detail.action.sourceDescriptor}
          />
        </div>
      ) : (
        <div className="grid gap-3">
          <JsonBlock
            title="request_descriptor_json"
            value={detail.action.requestDescriptor}
          />
          <JsonBlock
            title="page_progress_json"
            value={detail.action.pageProgress}
          />
          <JsonBlock
            title="source_descriptor_json"
            value={detail.action.sourceDescriptor}
          />
        </div>
      )}

      <div className="grid gap-3">
        <JsonBlock
          title="command_payload_json"
          value={firstCommand?.decodedPayload ?? null}
        />
        <JsonBlock
          title="event_payloads_json"
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
  search: Pick<AuditSearch, "family">,
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
  onRefresh,
  organizationSlug,
  projectionLag,
  search,
}: {
  isFetching: boolean;
  itemCount: number;
  nextCursor: string | null;
  onRefresh: () => void;
  organizationSlug: string;
  projectionLag: {
    queryAction: boolean;
    sourceApiAction: boolean;
  };
  search: AuditSearch;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => createAuditDraftFilters(search));
  const hasPendingDraftFilters = hasPendingAuditDraftFilters(search, draft);
  const actionNames = getAuditActionNamesForFamily(search.family);
  const laggingFamilyLabels = getLaggingAuditFamilyLabels(
    search,
    projectionLag
  );

  function navigateAuditSearch(next: Partial<AuditSearch>) {
    startTransition(() => {
      void navigate({
        params: { org_slug: organizationSlug },
        replace: true,
        search: buildAuditSearchWithDraft(search, draft, next),
        to: "/$org_slug/audit",
      });
    });
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateAuditSearch({ cursor: undefined });
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
          actionName: undefined,
          cursor: undefined,
          family: undefined,
          limit: search.limit,
          outcome: undefined,
          q: undefined,
          sourceKey: undefined,
        },
        to: "/$org_slug/audit",
      });
    });
  }

  return (
    <section className="rounded-xl border p-4">
      <form
        className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_180px_180px_180px_auto_auto]"
        onSubmit={handleFilterSubmit}
      >
        <div className="space-y-2">
          <Label htmlFor="audit-search">Search</Label>
          <Input
            id="audit-search"
            value={draft.q}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                q: event.target.value,
              }))
            }
            placeholder="Actor, query text, operation, or title"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="audit-source-key">Source Key</Label>
          <Input
            id="audit-source-key"
            value={draft.sourceKey}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sourceKey: event.target.value,
              }))
            }
            placeholder="warehouse"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="audit-outcome">Outcome</Label>
          <Select
            value={search.outcome ?? "all"}
            onValueChange={(value) => {
              navigateAuditSearch({
                cursor: undefined,
                outcome:
                  value && value !== "all"
                    ? (value as AuditSearch["outcome"])
                    : undefined,
              });
            }}
          >
            <SelectTrigger id="audit-outcome" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All outcomes</SelectItem>
              {AUDIT_OUTCOMES.map((outcome) => (
                <SelectItem key={outcome} value={outcome}>
                  {formatEnumLabel(outcome)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="audit-family">Family</Label>
          <Select
            value={search.family ?? "all"}
            onValueChange={(value) => {
              navigateAuditSearch({
                cursor: undefined,
                family:
                  value && value !== "all"
                    ? (value as AuditSearch["family"])
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

        <div className="space-y-2">
          <Label htmlFor="audit-action-name">Action</Label>
          <Select
            value={search.actionName ?? "all"}
            onValueChange={(value) => {
              navigateAuditSearch({
                actionName:
                  value && value !== "all"
                    ? (value as AuditSearch["actionName"])
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

        <div className="flex items-end">
          <Button
            type="submit"
            className="w-full lg:w-auto"
            disabled={!hasPendingDraftFilters}
          >
            Apply
          </Button>
        </div>

        <div className="flex items-end">
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

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          {itemCount} entries on this page
          {search.cursor ? " · viewing older results" : " · newest first"}
          {hasPendingDraftFilters ? " · apply search filters to paginate" : ""}
          {isFetching ? " · updating" : ""}
        </p>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              aria-label="Refresh audit feed"
              className={buttonVariants({ size: "icon", variant: "outline" })}
              disabled={isFetching}
              onClick={onRefresh}
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

          {search.cursor ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => navigateAuditSearch({ cursor: undefined })}
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

              navigateAuditSearch({ cursor: nextCursor });
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
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Audit</h1>
        <p className="text-muted-foreground mt-2">
          Trace query and source API workflows from command intake through raw
          events, payloads, metrics, and projection state.
        </p>
      </div>

      <AuditFiltersSection
        key={getAuditDraftResetKey(search)}
        isFetching={isFetching}
        itemCount={data.items.length}
        nextCursor={data.nextCursor}
        onRefresh={() => {
          void refetch();
        }}
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)]">
          <section className="min-w-0 rounded-md border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="font-semibold">Trace feed</h2>
                <p className="text-muted-foreground text-xs">
                  Newest audited actions with source, actor, status, and shape.
                </p>
              </div>
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <IconListDetails size={16} stroke={1.75} />
                {data.projectedThrough.queryAction ||
                data.projectedThrough.sourceApiAction
                  ? "Projection caught up"
                  : "Projection pending"}
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor / source</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Status</TableHead>
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
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="font-semibold">Trace detail</h2>
                <p className="text-muted-foreground text-xs">
                  Commands, event log, payload bytes, and action fold state.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <IconRoute className="text-muted-foreground size-4" />
                <IconDatabase className="text-muted-foreground size-4" />
                <IconClock className="text-muted-foreground size-4" />
              </div>
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-auto p-4">
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
