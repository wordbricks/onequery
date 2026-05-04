import type {
  AuditActionDetail,
  AuditListItem,
} from "@onequery/audit-contracts/audit";
import { formatDateTime } from "@onequery/datetime/format-date";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@onequery/ui/components/alert";
import { CopyButton } from "@onequery/ui/components/copy-button";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { z } from "zod";

import {
  formatAuditBytes,
  formatAuditEnumLabel,
  getAuditActorLabel,
  getAuditDurationLabel,
  getAuditOutcomeDotClassName,
  getAuditTraceIdLabel,
  getAuditVolumeLabel,
} from "./audit-display";

const evidenceTextSchema = z
  .unknown()
  .transform((value) => {
    if (value === null || value === undefined) {
      return "Not recorded";
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : "Not recorded";
    }

    return JSON.stringify(value, null, 2) ?? String(value);
  })
  .catch("Not recorded");

const auditSourceDescriptorSchema = z
  .object({
    displayName: z.string().nullable().optional(),
    name: z.string().optional(),
    provider: z.string().optional(),
    sourceId: z.string().optional(),
    sourceKey: z.string().optional(),
    sourceStatus: z.string().optional(),
  })
  .passthrough();
const auditSourceDescriptorViewSchema = auditSourceDescriptorSchema
  .nullable()
  .catch(null);

const auditRequestDescriptorSchema = z
  .object({
    descriptorVersion: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    method: z.string().nullable().optional(),
    operation: z.string().optional(),
    paginationPolicy: z.string().nullable().optional(),
    selector: z.string().nullable().optional(),
  })
  .passthrough();
const auditRequestDescriptorViewSchema = auditRequestDescriptorSchema
  .nullable()
  .catch(null);

const auditPageProgressSchema = z
  .object({
    nextPageIndex: z.number().int().optional(),
  })
  .passthrough();
const auditPageProgressViewSchema = auditPageProgressSchema
  .nullable()
  .catch(null);

function DetailFact({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) {
    return null;
  }

  return (
    <div className="min-w-0">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 truncate text-xs font-medium">{value}</div>
    </div>
  );
}

function DetailFactGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>;
}

function getOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatOptionalEnumLabel(value: string | null | undefined) {
  const text = getOptionalText(value);
  return text ? formatAuditEnumLabel(text) : null;
}

function formatEvidenceValue(value: unknown) {
  return evidenceTextSchema.parse(value);
}

function DetailSection({
  children,
  meta,
  title,
}: {
  children: ReactNode;
  meta?: string;
  title: string;
}) {
  return (
    <section className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {meta ? (
          <span className="text-muted-foreground shrink-0 text-xs">{meta}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EvidenceBlock({
  maxHeightClassName = "max-h-64",
  title,
  value,
}: {
  maxHeightClassName?: string;
  title: string;
  value: unknown;
}) {
  const formattedValue = formatEvidenceValue(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium">{title}</h4>
        <CopyButton value={formattedValue} className="size-7 shrink-0" />
      </div>
      <pre
        className={`bg-muted/40 ${maxHeightClassName} overflow-auto rounded-md border p-3 font-mono text-[11px] leading-5 break-words whitespace-pre-wrap`}
      >
        {formattedValue}
      </pre>
    </div>
  );
}

function AuditFailureNotice({ item }: { item: AuditListItem }) {
  const errorDetail = item.preview?.errorDetail;
  const errorHint =
    item.family === "query_action" ? item.preview?.errorHint : null;

  if (!errorDetail) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <IconAlertTriangle className="size-4" />
      <AlertTitle>Failure detail</AlertTitle>
      <AlertDescription className="space-y-2">
        {item.failureCode ? (
          <div className="text-xs font-medium">
            {formatAuditEnumLabel(item.failureCode)}
          </div>
        ) : null}
        <p className="whitespace-pre-wrap">{errorDetail}</p>
        {errorHint ? (
          <p className="text-muted-foreground whitespace-pre-wrap">
            {errorHint}
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function SourceDescriptorOverview({ value }: { value: unknown }) {
  const source = auditSourceDescriptorViewSchema.parse(value);

  return (
    <div className="space-y-3">
      {source ? (
        <DetailFactGrid>
          <DetailFact
            label="Display name"
            value={getOptionalText(source.displayName)}
          />
          <DetailFact label="Name" value={getOptionalText(source.name)} />
          <DetailFact
            label="Provider"
            value={formatOptionalEnumLabel(source.provider)}
          />
          <DetailFact label="Source key" value={source.sourceKey} />
          <DetailFact label="Source ID" value={source.sourceId} />
          <DetailFact
            label="Status"
            value={formatOptionalEnumLabel(source.sourceStatus)}
          />
        </DetailFactGrid>
      ) : null}
      <EvidenceBlock
        maxHeightClassName="max-h-48"
        title="Descriptor"
        value={value}
      />
    </div>
  );
}

function SourceApiRequestOverview({
  action,
}: {
  action: Extract<AuditActionDetail, { family: "source_api_action" }>["action"];
}) {
  const request = auditRequestDescriptorViewSchema.parse(
    action.requestDescriptor
  );
  const pageProgress = auditPageProgressViewSchema.parse(action.pageProgress);
  const method = getOptionalText(request?.method);
  const operation = getOptionalText(request?.operation);
  const selector = getOptionalText(request?.selector);

  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3">
        <div className="mb-3 flex min-w-0 items-center gap-2">
          {method ? (
            <span className="bg-muted shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium">
              {method}
            </span>
          ) : null}
          <div className="min-w-0 truncate text-xs font-medium">
            {operation ??
              selector ??
              action.preparedRequestFingerprint ??
              "n/a"}
          </div>
        </div>
        <DetailFactGrid>
          <DetailFact label="Selector" value={selector} />
          <DetailFact
            label="Request kind"
            value={formatAuditEnumLabel(action.requestKind)}
          />
          <DetailFact
            label="Invoke mode"
            value={formatOptionalEnumLabel(action.invokeMode)}
          />
          <DetailFact
            label="Operation kind"
            value={formatOptionalEnumLabel(request?.kind)}
          />
          <DetailFact
            label="Pagination"
            value={formatOptionalEnumLabel(request?.paginationPolicy)}
          />
          <DetailFact
            label="Next page"
            value={
              pageProgress?.nextPageIndex === undefined
                ? null
                : `${pageProgress.nextPageIndex}`
            }
          />
          <DetailFact
            label="Attempt"
            value={
              action.attemptNumber === null ? null : `${action.attemptNumber}`
            }
          />
        </DetailFactGrid>
      </div>

      <EvidenceBlock
        maxHeightClassName="max-h-48"
        title="Request descriptor"
        value={action.requestDescriptor}
      />
      <EvidenceBlock
        maxHeightClassName="max-h-36"
        title="Page progress"
        value={action.pageProgress}
      />
    </div>
  );
}

function QueryActionOverview({
  action,
}: {
  action: Extract<AuditActionDetail, { family: "query_action" }>["action"];
}) {
  return (
    <div className="space-y-3">
      <EvidenceBlock
        maxHeightClassName="max-h-72"
        title="SQL"
        value={action.queryText}
      />
      <DetailFactGrid>
        <DetailFact
          label="Query mode"
          value={formatOptionalEnumLabel(action.queryMode)}
        />
        <DetailFact
          label="Usage recording"
          value={formatAuditEnumLabel(action.usageRecordingStatus)}
        />
      </DetailFactGrid>
      <EvidenceBlock
        maxHeightClassName="max-h-56"
        title="Validated query"
        value={action.validatedQuery}
      />
    </div>
  );
}

function AuditTimeline({ events }: { events: AuditActionDetail["events"] }) {
  return (
    <div className="divide-y rounded-md border">
      {events.map((event) => (
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
                {formatAuditEnumLabel(event.eventType)}
              </span>
              <span className="text-muted-foreground shrink-0 text-[11px]">
                {formatAuditBytes(event.payload.byteLength)}
              </span>
            </div>
            <div className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
              {formatDateTime(event.occurredAt)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditTraceHeader({
  action,
  item,
  meta,
}: {
  action?: ReactNode;
  item: AuditListItem;
  meta: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`size-2 rounded-full ${getAuditOutcomeDotClassName(
              item.outcome
            )}`}
          />
          <span className="font-medium">
            {formatAuditEnumLabel(item.outcome)}
          </span>
          <span className="text-muted-foreground">{meta}</span>
        </div>
        <h2 className="mt-2 truncate text-base font-semibold">{item.title}</h2>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {item.subtitle}
        </p>
      </div>
      {action}
    </div>
  );
}

export function AuditTraceDetailSkeleton({ item }: { item: AuditListItem }) {
  return (
    <div className="space-y-4">
      <AuditTraceHeader item={item} meta={item.family} />
      <div className="rounded-md border p-3 text-xs">
        Loading full command and event trace…
      </div>
    </div>
  );
}

export function AuditTraceDetail({
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
        <AuditTraceHeader
          action={<CopyButton value={item.id} className="size-7 shrink-0" />}
          item={item}
          meta={formatDateTime(item.startedAt)}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3">
        <DetailFact label="Actor" value={getAuditActorLabel(item)} />
        <DetailFact label="Source" value={item.target.sourceKey} />
        <DetailFact label="Duration" value={getAuditDurationLabel(item)} />
        <DetailFact
          label="Rows / Pages"
          value={getAuditVolumeLabel(item) || "n/a"}
        />
        <DetailFact label="Phase" value={formatAuditEnumLabel(item.phase)} />
        <DetailFact
          label="Action"
          value={formatAuditEnumLabel(item.actionName)}
        />
        <DetailFact
          label="Last event"
          value={formatAuditEnumLabel(item.lastEventType)}
        />
        <DetailFact
          label="Failure"
          value={
            item.failureCode ? formatAuditEnumLabel(item.failureCode) : "n/a"
          }
        />
        <DetailFact label="Trace ID" value={getAuditTraceIdLabel(item)} />
      </div>

      <AuditFailureNotice item={item} />

      {detail.family === "query_action" ? (
        <DetailSection title="Query">
          <QueryActionOverview action={detail.action} />
        </DetailSection>
      ) : (
        <DetailSection title="Request">
          <SourceApiRequestOverview action={detail.action} />
        </DetailSection>
      )}

      <DetailSection title="Source">
        <SourceDescriptorOverview value={detail.action.sourceDescriptor} />
      </DetailSection>

      <DetailSection title="Metrics">
        <EvidenceBlock
          maxHeightClassName="max-h-40"
          title="Metrics"
          value={item.metrics}
        />
      </DetailSection>

      <DetailSection
        meta={`${detail.events.length} events`}
        title="Event timeline"
      >
        <AuditTimeline events={detail.events} />
      </DetailSection>

      <DetailSection title="Raw trace">
        <div className="grid gap-3">
          <EvidenceBlock
            title="Command payload"
            value={firstCommand?.decodedPayload}
          />
          <EvidenceBlock
            title="Events"
            value={detail.events.map((event) => ({
              commandId: event.commandId,
              eventType: event.eventType,
              id: event.id,
              payload: event.decodedPayload,
              sequence: event.sequence,
            }))}
          />
        </div>
      </DetailSection>
    </div>
  );
}
