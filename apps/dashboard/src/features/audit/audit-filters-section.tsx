import {
  AUDIT_FAMILIES,
  AUDIT_OUTCOMES,
  getAuditActionNamesForFamily,
} from "@onequery/audit-contracts/audit";
import type {
  AuditListParams,
  AuditProjectionLag,
} from "@onequery/audit-contracts/audit";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@onequery/ui/components/alert";
import { Button } from "@onequery/ui/components/button";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@onequery/ui/components/select";
import { cn } from "@onequery/ui/lib/utils";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { startTransition, useState } from "react";
import type { FormEvent } from "react";

import {
  buildAuditListParamsWithDraft,
  createAuditDraftFilters,
  hasPendingAuditDraftFilters,
} from "@/features/audit/audit-filter-state";

import {
  AUDIT_OUTCOME_DOT_CLASS_NAMES,
  formatAuditEnumLabel,
  getLaggingAuditFamilyLabel,
} from "./audit-display";

type AuditFiltersSectionProps = {
  isFetching: boolean;
  itemCount: number;
  nextCursor: string | null;
  organizationSlug: string;
  projectionLag: AuditProjectionLag;
  search: AuditListParams;
};

export function AuditFiltersSection({
  isFetching,
  itemCount,
  nextCursor,
  organizationSlug,
  projectionLag,
  search,
}: AuditFiltersSectionProps) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => createAuditDraftFilters(search));
  const hasPendingDraftFilters = hasPendingAuditDraftFilters(search, draft);
  const actionNames = getAuditActionNamesForFamily(search.family);
  const laggingFamilyLabel = getLaggingAuditFamilyLabel({
    projectionLag,
    search,
  });

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
    <section className="min-w-0 border-b pb-4">
      <form className="space-y-3" onSubmit={handleFilterSubmit}>
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.3fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)_minmax(150px,0.7fr)]">
          <div className="min-w-0 space-y-1.5 md:col-span-2 xl:col-span-1">
            <Label
              htmlFor="audit-search"
              className="text-muted-foreground text-xs font-medium"
            >
              Search
            </Label>
            <div className="relative">
              <IconSearch
                className="text-muted-foreground absolute top-2.5 left-2.5 size-4"
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
                placeholder="Actor, source, query"
              />
            </div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label
              htmlFor="audit-source-key"
              className="text-muted-foreground text-xs font-medium"
            >
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
              placeholder="Source key"
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label
              htmlFor="audit-family"
              className="text-muted-foreground text-xs font-medium"
            >
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
                    {formatAuditEnumLabel(family)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label
              htmlFor="audit-action-name"
              className="text-muted-foreground text-xs font-medium"
            >
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
                    {formatAuditEnumLabel(actionName)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label className="text-muted-foreground text-xs font-medium">
              Outcome
            </Label>
            <div className="grid min-w-0 grid-cols-2 gap-1 rounded-md border p-px sm:flex sm:flex-wrap">
              <Button
                type="button"
                variant={search.outcome ? "ghost" : "secondary"}
                size="sm"
                className="min-w-0 justify-center sm:min-w-16"
                aria-pressed={!search.outcome}
                onClick={() =>
                  navigateAuditListParams({
                    cursor: undefined,
                    outcome: undefined,
                  })
                }
              >
                All
              </Button>
              {AUDIT_OUTCOMES.map((outcome) => (
                <Button
                  key={outcome}
                  type="button"
                  variant={search.outcome === outcome ? "secondary" : "ghost"}
                  size="sm"
                  className="min-w-0 justify-center sm:min-w-24"
                  aria-pressed={search.outcome === outcome}
                  onClick={() =>
                    navigateAuditListParams({
                      cursor: undefined,
                      outcome,
                    })
                  }
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      AUDIT_OUTCOME_DOT_CLASS_NAMES[outcome]
                    )}
                  />
                  {formatAuditEnumLabel(outcome)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              size="sm"
              className="w-full sm:w-auto"
              disabled={!hasPendingDraftFilters}
            >
              <IconCheck size={16} stroke={2} />
              Apply
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleClearFilters}
            >
              <IconX size={16} stroke={2} />
              Clear
            </Button>
          </div>
        </div>
      </form>

      {laggingFamilyLabel ? (
        <Alert className="mt-4 border-amber-300/60 bg-amber-50/80 text-amber-950">
          <IconAlertTriangle className="size-4" />
          <AlertTitle>Audit feed is still catching up</AlertTitle>
          <AlertDescription>
            Recent {laggingFamilyLabel} events may not appear yet. This page
            will refresh while the feed catches up.
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
