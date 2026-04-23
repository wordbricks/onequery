import {
  AUDIT_FAMILIES,
  AUDIT_OUTCOMES,
  getAuditActionNamesForFamily,
} from "@onequery/contracts/audit";
import { formatDateTime } from "@onequery/datetime/format-date";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@onequery/ui/components/alert";
import { Badge } from "@onequery/ui/components/badge";
import { Button } from "@onequery/ui/components/button";
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
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconHistory,
} from "@tabler/icons-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { startTransition, useState } from "react";
import type { FormEvent } from "react";

import {
  buildAuditSearchWithDraft,
  createAuditDraftFilters,
  getAuditDraftResetKey,
  hasPendingAuditDraftFilters,
} from "@/features/audit/audit-filter-state";
import { auditListQueryOptions } from "@/queries/audit-queries";
import type { AuditListItem, AuditSearch } from "@/queries/audit-queries";

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

function AuditTableRow({ item }: { item: AuditListItem }) {
  const metricsLabel = getMetricsLabel(item);

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="min-w-[170px]">
          <div className="font-medium">{formatDateTime(item.startedAt)}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Started · {formatEnumLabel(item.originSurface)}
          </div>
          {item.lastEventAt !== item.startedAt ? (
            <div className="text-muted-foreground mt-1 text-xs">
              Last event · {formatDateTime(item.lastEventAt)}
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="font-medium">{getActorLabel(item)}</div>
        <div className="text-muted-foreground mt-1 text-xs">
          {item.originActor.membershipRoles.length > 0
            ? item.originActor.membershipRoles.map(formatEnumLabel).join(", ")
            : "No membership roles recorded"}
        </div>
      </TableCell>
      <TableCell className="min-w-[420px] align-top whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{formatEnumLabel(item.family)}</Badge>
          <span className="font-medium">{item.title}</span>
        </div>
        <div className="text-muted-foreground mt-2 text-sm">
          {item.subtitle}
        </div>
        <div className="text-muted-foreground mt-2 text-xs font-mono break-words">
          {getDetailLine(item)}
        </div>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="flex flex-col gap-2">
          <Badge variant={getOutcomeBadgeVariant(item.outcome)}>
            {formatEnumLabel(item.outcome)}
          </Badge>
          <div className="text-muted-foreground text-xs">
            {formatEnumLabel(item.phase)}
          </div>
          <div className="text-muted-foreground text-xs">
            {formatEnumLabel(item.lastEventType)}
          </div>
          {metricsLabel ? (
            <div className="text-muted-foreground text-xs">{metricsLabel}</div>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
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
            yet. Refresh again before treating this history as complete.
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
  const { data, isFetching } = useSuspenseQuery(
    auditListQueryOptions(session.user.id, organizationSlug, search)
  );

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Audit</h1>
        <p className="text-muted-foreground mt-2">
          One row per audited action across query and source API workflows.
          Ordered by action start time so pagination stays stable while actions
          continue to evolve.
        </p>
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
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <AuditTableRow key={item.id} item={item} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
