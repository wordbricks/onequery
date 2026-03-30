import {
  CLI_QUERY_ACTION_STATUSES,
  CLI_QUERY_ACTION_TYPES,
} from "@onequery/contracts/audit";
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
  IconArrowLeft,
  IconArrowRight,
  IconHistory,
} from "@tabler/icons-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { startTransition, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { auditListQueryOptions } from "@/queries/audit-queries";
import type { AuditListItem, AuditSearch } from "@/queries/audit-queries";

const routeApi = getRouteApi("/_authenticated/$org_slug/audit");

function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function normalizeSearchValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function truncateSql(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function getStatusBadgeVariant(status: AuditListItem["state"]["status"]) {
  if (status === "succeeded") {
    return "secondary" as const;
  }

  if (status === "pending") {
    return "outline" as const;
  }

  return "destructive" as const;
}

function AuditTableRow({ item }: { item: AuditListItem }) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="min-w-[140px]">
          <div className="font-medium">{formatTimestamp(item.occurredAt)}</div>
          <div className="text-muted-foreground text-xs mt-1">
            {item.action.requestId}
          </div>
        </div>
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="font-medium">{item.actor.email}</div>
        <div className="text-muted-foreground text-xs mt-1">
          {item.actor.membershipRoles.map(formatEnumLabel).join(", ")}
        </div>
      </TableCell>
      <TableCell className="align-top whitespace-normal min-w-[360px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {formatEnumLabel(item.action.type)}
          </span>
          <span className="text-muted-foreground text-xs">
            on <span className="font-medium">{item.action.sourceKey}</span>
          </span>
        </div>
        <div className="text-muted-foreground text-xs mt-2 font-mono break-words">
          {truncateSql(item.query.sql)}
        </div>
        {item.error ? (
          <div className="text-destructive text-xs mt-2">
            {item.error.detail ?? item.error.hint}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="flex flex-col gap-2">
          <Badge variant={getStatusBadgeVariant(item.state.status)}>
            {formatEnumLabel(item.state.status)}
          </Badge>
          <div className="text-muted-foreground text-xs">
            {formatEnumLabel(item.state.lastEventType)}
          </div>
          <div className="text-muted-foreground text-xs">
            {item.metrics.elapsedMs !== null
              ? `${item.metrics.elapsedMs} ms`
              : "No duration"}
            {item.metrics.rowCount !== null
              ? ` · ${item.metrics.rowCount} rows`
              : ""}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AuditPage() {
  const navigate = useNavigate();
  const { organizationSlug, session } = routeApi.useRouteContext();
  const search = routeApi.useSearch();
  const { data, isFetching } = useSuspenseQuery(
    auditListQueryOptions(session.user.id, organizationSlug, search)
  );
  const [queryInput, setQueryInput] = useState(search.q ?? "");
  const [sourceKeyInput, setSourceKeyInput] = useState(search.sourceKey ?? "");

  useEffect(() => {
    setQueryInput(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setSourceKeyInput(search.sourceKey ?? "");
  }, [search.sourceKey]);

  function updateAuditSearch(next: Partial<AuditSearch>) {
    startTransition(() => {
      navigate({
        params: { org_slug: organizationSlug },
        replace: true,
        search: (prev) => ({
          ...prev,
          limit: prev.limit,
          ...next,
        }),
        to: "/$org_slug/audit",
      });
    });
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateAuditSearch({
      cursor: undefined,
      q: normalizeSearchValue(queryInput),
      sourceKey: normalizeSearchValue(sourceKeyInput),
    });
  }

  function handleClearFilters() {
    setQueryInput("");
    setSourceKeyInput("");

    startTransition(() => {
      navigate({
        params: { org_slug: organizationSlug },
        replace: true,
        search: {
          actionType: undefined,
          cursor: undefined,
          limit: search.limit,
          q: undefined,
          sourceKey: undefined,
          status: undefined,
        },
        to: "/$org_slug/audit",
      });
    });
  }

  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Audit</h1>
        <p className="text-muted-foreground mt-2">
          Organization history for CLI query activity. This v1 surface tracks
          validate and execute trails in reverse chronological order.
        </p>
      </div>

      <section className="rounded-xl border p-4">
        <form
          className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_200px_180px_auto_auto]"
          onSubmit={handleFilterSubmit}
        >
          <div className="space-y-2">
            <Label htmlFor="audit-query-search">Search</Label>
            <Input
              id="audit-query-search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Actor email or SQL text"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-source-key">Source Key</Label>
            <Input
              id="audit-source-key"
              value={sourceKeyInput}
              onChange={(event) => setSourceKeyInput(event.target.value)}
              placeholder="warehouse"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-status">Status</Label>
            <Select
              value={search.status ?? "all"}
              onValueChange={(value) => {
                updateAuditSearch({
                  cursor: undefined,
                  status:
                    value && value !== "all"
                      ? (value as AuditSearch["status"])
                      : undefined,
                });
              }}
            >
              <SelectTrigger id="audit-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {CLI_QUERY_ACTION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {formatEnumLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-action-type">Action</Label>
            <Select
              value={search.actionType ?? "all"}
              onValueChange={(value) => {
                updateAuditSearch({
                  actionType:
                    value && value !== "all"
                      ? (value as AuditSearch["actionType"])
                      : undefined,
                  cursor: undefined,
                });
              }}
            >
              <SelectTrigger id="audit-action-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {CLI_QUERY_ACTION_TYPES.map((actionType) => (
                  <SelectItem key={actionType} value={actionType}>
                    {formatEnumLabel(actionType)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button type="submit" className="w-full lg:w-auto">
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

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">
            {data.items.length} entries on this page
            {search.cursor ? " · viewing older results" : " · newest first"}
            {isFetching ? " · updating" : ""}
          </p>

          <div className="flex items-center gap-2">
            {search.cursor ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => updateAuditSearch({ cursor: undefined })}
              >
                <IconArrowLeft size={16} stroke={2} />
                Newest
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!data.nextCursor) {
                  return;
                }

                updateAuditSearch({ cursor: data.nextCursor });
              }}
              disabled={!data.nextCursor}
            >
              Older
              <IconArrowRight size={16} stroke={2} />
            </Button>
          </div>
        </div>
      </section>

      {data.items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconHistory size={18} stroke={1.75} />
            </EmptyMedia>
            <EmptyTitle>No audit entries matched these filters</EmptyTitle>
            <EmptyDescription>
              Try clearing the filters or waiting for new CLI query activity in
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
