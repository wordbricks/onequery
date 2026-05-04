import { Button, buttonVariants } from "@onequery/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@onequery/ui/components/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@onequery/ui/components/tooltip";
import { IconDownload, IconHistory, IconRefresh } from "@tabler/icons-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import {
  AuditEntriesLayout,
  getAuditEntriesLayoutKey,
} from "@/features/audit/audit-entries-layout";
import { downloadAuditCsv } from "@/features/audit/audit-export";
import { getAuditDraftResetKey } from "@/features/audit/audit-filter-state";
import { AuditFiltersSection } from "@/features/audit/audit-filters-section";
import { auditListQueryOptions } from "@/queries/audit-queries";

const routeApi = getRouteApi("/_authenticated/$org_slug/audit");

export function AuditPage() {
  const { organizationSlug, session } = routeApi.useRouteContext();
  const search = routeApi.useSearch();
  const { data, isFetching, refetch } = useSuspenseQuery(
    auditListQueryOptions(session.user.id, organizationSlug, search)
  );
  const initialAuditItem = data.items[0];

  return (
    <div className="min-w-0 space-y-4 p-6">
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

      {initialAuditItem === undefined ? (
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
        <AuditEntriesLayout
          key={getAuditEntriesLayoutKey(data.items)}
          initialItem={initialAuditItem}
          items={data.items}
          organizationSlug={organizationSlug}
          userId={session.user.id}
        />
      )}
    </div>
  );
}
