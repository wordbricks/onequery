import type { AuditListItem } from "@onequery/audit-contracts/audit";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@onequery/ui/components/alert";
import { buttonVariants } from "@onequery/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@onequery/ui/components/tooltip";
import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useActor } from "@xstate/react";

import { auditActionDetailQueryOptions } from "@/queries/audit-queries";

import {
  AUDIT_DETAIL_PANEL_EVENT,
  AUDIT_DETAIL_PANEL_TAG,
  auditDetailPanelMachine,
} from "./audit-detail-panel-machine";
import { AuditEntriesTable } from "./audit-list-table";
import {
  AuditTraceDetail,
  AuditTraceDetailSkeleton,
} from "./audit-trace-detail";

type AuditEntriesLayoutProps = {
  initialItem: AuditListItem;
  items: readonly AuditListItem[];
  organizationSlug: string;
  userId: string;
};

export function getAuditEntriesLayoutKey(items: readonly AuditListItem[]) {
  return items.map((item) => item.id).join(":");
}

export function AuditEntriesLayout({
  initialItem,
  items,
  organizationSlug,
  userId,
}: AuditEntriesLayoutProps) {
  const [detailPanelState, sendDetailPanel] = useActor(
    auditDetailPanelMachine,
    {
      input: {
        initialItem,
      },
    }
  );
  const selectedItem = detailPanelState.context.selectedItem;
  const isDetailPanelOpen = detailPanelState.hasTag(
    AUDIT_DETAIL_PANEL_TAG.DETAILS_VISIBLE
  );
  const detailQuery = useQuery({
    ...auditActionDetailQueryOptions(
      userId,
      organizationSlug,
      selectedItem.family,
      selectedItem.familyActionId
    ),
    enabled: isDetailPanelOpen,
  });

  return (
    <div
      className={
        isDetailPanelOpen
          ? "grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]"
          : "grid min-h-0 gap-4"
      }
    >
      <AuditEntriesTable
        isDetailOpen={isDetailPanelOpen}
        items={items}
        selectedItemId={selectedItem.id}
        onSelectItem={(item) =>
          sendDetailPanel({
            item,
            type: AUDIT_DETAIL_PANEL_EVENT.ROW_SELECTED,
          })
        }
      />

      {isDetailPanelOpen ? (
        <aside className="min-w-0 rounded-md border">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div>
              <h2 className="text-sm font-semibold">Details</h2>
            </div>
            <Tooltip>
              <TooltipTrigger
                aria-label="Collapse details"
                className={buttonVariants({
                  size: "icon-sm",
                  variant: "ghost",
                })}
                onClick={() =>
                  sendDetailPanel({
                    type: AUDIT_DETAIL_PANEL_EVENT.CLOSE_DETAILS,
                  })
                }
                type="button"
              >
                <IconX size={16} stroke={2} />
              </TooltipTrigger>
              <TooltipContent>Collapse details</TooltipContent>
            </Tooltip>
          </div>
          <div className="max-h-[calc(100vh-240px)] overflow-auto p-3">
            {detailQuery.isPending ? (
              <AuditTraceDetailSkeleton item={selectedItem} />
            ) : null}
            {detailQuery.isError ? (
              <div className="space-y-4">
                <AuditTraceDetailSkeleton item={selectedItem} />
                <Alert variant="destructive">
                  <IconAlertTriangle className="size-4" />
                  <AlertTitle>Failed to load trace detail</AlertTitle>
                  <AlertDescription>
                    {detailQuery.error.message}
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}
            {detailQuery.data ? (
              <AuditTraceDetail
                key={selectedItem.id}
                detail={detailQuery.data}
                item={selectedItem}
              />
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
