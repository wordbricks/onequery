import {
  auditListResponseSchema,
  auditOriginActorSchema,
  auditQueryActionMetricsSchema,
  auditQueryActionPreviewSchema,
  auditSourceApiActionMetricsSchema,
  auditSourceApiActionPreviewSchema,
  auditTargetSchema,
} from "@onequery/audit-contracts/audit";
import type {
  AuditListParams,
  AuditListResponse,
  AuditOutcome,
  AuditProjectionLag,
  AuditProjectedThrough,
  AuditQueryActionEventType,
  AuditQueryActionFailureCode,
  AuditQueryActionPhase,
  AuditSourceApiActionEventType,
  AuditSourceApiActionFailureCode,
  AuditSourceApiActionPhase,
} from "@onequery/audit-contracts/audit";
import {
  and,
  asc,
  auditFeedEntries,
  auditProjectionCheckpoints,
  desc,
  eq,
  gt,
  inArray,
  lt,
  or,
  sql,
  workflowJournal,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";

import { AUDIT_FEED_PROJECTION_NAME } from "./constants";
import {
  buildAuditFeedId,
  decodeAuditCursor,
  encodeAuditCursor,
} from "./cursor";
import { InvalidAuditCursorError } from "./errors";
import {
  buildCaseInsensitiveContains,
  buildCaseInsensitiveEquals,
} from "./filtering";
import { syncAuditFeedProjection } from "./projection";
import {
  QueryActionProjectionPreviewSchema,
  SourceApiActionProjectionPreviewSchema,
} from "./schemas";
import type {
  AuditProjectionCheckpointPositions,
  AuditProjectionCheckpointSnapshot,
  DatabaseExecutor,
} from "./types";

function serializeAuditProjectedThrough(
  checkpoints: AuditProjectionCheckpointSnapshot
): AuditProjectedThrough {
  return {
    queryAction:
      checkpoints.queryAction === null
        ? null
        : checkpoints.queryAction.toString(),
    sourceApiAction:
      checkpoints.sourceApiAction === null
        ? null
        : checkpoints.sourceApiAction.toString(),
  };
}

function normalizeAuditProjectionCheckpointSnapshot(
  checkpoints: AuditProjectionCheckpointSnapshot
): AuditProjectionCheckpointPositions {
  return {
    queryAction: checkpoints.queryAction ?? 0n,
    sourceApiAction: checkpoints.sourceApiAction ?? 0n,
  };
}

async function loadAuditProjectionCheckpointSnapshot(
  db: DatabaseExecutor
): Promise<AuditProjectionCheckpointSnapshot> {
  const checkpoints: AuditProjectionCheckpointSnapshot = {
    queryAction: null,
    sourceApiAction: null,
  };
  const rows = await db
    .select({
      family: auditProjectionCheckpoints.family,
      lastCommitPosition: auditProjectionCheckpoints.lastCommitPosition,
    })
    .from(auditProjectionCheckpoints)
    .where(
      eq(auditProjectionCheckpoints.projectionName, AUDIT_FEED_PROJECTION_NAME)
    );

  for (const row of rows) {
    if (row.family === "query_action") {
      checkpoints.queryAction = row.lastCommitPosition;
      continue;
    }

    if (row.family === "source_api_action") {
      checkpoints.sourceApiAction = row.lastCommitPosition;
    }
  }

  return checkpoints;
}

async function hasUnprojectedWorkflowJournalEvents(
  db: DatabaseExecutor,
  family: "query_action" | "source_api_action",
  lastCommitPosition: bigint,
  organizationId: string
) {
  const rows = await db
    .select({ eventId: workflowJournal.id })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, family),
        eq(workflowJournal.entryKind, "event"),
        gt(workflowJournal.commitPosition, lastCommitPosition),
        eq(workflowJournal.organizationId, organizationId)
      )
    )
    .limit(1);

  return rows.length > 0;
}

async function loadAuditProjectionLag(
  db: DatabaseExecutor,
  checkpoints: AuditProjectionCheckpointPositions,
  organizationId: string
): Promise<AuditProjectionLag> {
  const [queryAction, sourceApiAction] = await Promise.all([
    hasUnprojectedWorkflowJournalEvents(
      db,
      "query_action",
      checkpoints.queryAction,
      organizationId
    ),
    hasUnprojectedWorkflowJournalEvents(
      db,
      "source_api_action",
      checkpoints.sourceApiAction,
      organizationId
    ),
  ]);

  return {
    queryAction,
    sourceApiAction,
  };
}

export function serializeAuditFeedItem(
  row: typeof auditFeedEntries.$inferSelect,
  requestId: string | null = null
) {
  const originActor = auditOriginActorSchema.parse(row.originActorJson);
  const target = auditTargetSchema.parse(row.targetJson);

  if (row.family === "query_action") {
    const preview =
      row.familyPreviewJson === null
        ? null
        : (() => {
            const storedPreview = QueryActionProjectionPreviewSchema.parse(
              row.familyPreviewJson
            );

            return auditQueryActionPreviewSchema.parse({
              elapsedMs: storedPreview.elapsedMs,
              errorDetail: storedPreview.errorDetail,
              errorHint: storedPreview.errorHint,
              queryText: storedPreview.queryText,
              rowCount: storedPreview.rowCount,
              usageRecordingStatus: storedPreview.usageRecordingStatus,
              validatedQuery: storedPreview.validatedQuery,
            });
          })();

    return {
      actionName:
        row.actionName === "validate" || row.actionName === "execute"
          ? row.actionName
          : (() => {
              throw new Error(
                `invalid query_action action name: ${row.actionName}`
              );
            })(),
      completedAt: row.completedAt?.toISOString() ?? null,
      failureCode:
        row.failureCode === null
          ? null
          : (row.failureCode as AuditQueryActionFailureCode),
      family: "query_action" as const,
      familyActionId: row.familyActionId,
      id: buildAuditFeedId(row.family, row.familyActionId),
      lastEventAt: row.lastEventAt.toISOString(),
      lastEventType: row.lastEventType as AuditQueryActionEventType,
      metrics:
        row.metricsJson === null
          ? null
          : auditQueryActionMetricsSchema.parse(row.metricsJson),
      originActor,
      originSurface: row.originSurface,
      outcome: row.outcome as AuditOutcome,
      phase: row.phase as AuditQueryActionPhase,
      preview,
      requestId,
      startedAt: row.startedAt.toISOString(),
      subtitle: row.subtitle,
      target,
      title: row.title,
    };
  }

  const preview =
    row.familyPreviewJson === null
      ? null
      : (() => {
          const storedPreview = SourceApiActionProjectionPreviewSchema.parse(
            row.familyPreviewJson
          );

          return auditSourceApiActionPreviewSchema.parse({
            attemptNumber: storedPreview.attemptNumber,
            errorDetail: storedPreview.errorDetail,
            httpStatus: storedPreview.httpStatus,
            invokeMode: storedPreview.invokeMode,
            method: storedPreview.method,
            operation: storedPreview.operation,
            pageCount: storedPreview.pageCount,
            selector: storedPreview.selector,
          });
        })();

  return {
    actionName:
      row.actionName === "describe" || row.actionName === "invoke"
        ? row.actionName
        : (() => {
            throw new Error(
              `invalid source_api_action action name: ${row.actionName}`
            );
          })(),
    completedAt: row.completedAt?.toISOString() ?? null,
    failureCode:
      row.failureCode === null
        ? null
        : (row.failureCode as AuditSourceApiActionFailureCode),
    family: "source_api_action" as const,
    familyActionId: row.familyActionId,
    id: buildAuditFeedId(row.family, row.familyActionId),
    lastEventAt: row.lastEventAt.toISOString(),
    lastEventType: row.lastEventType as AuditSourceApiActionEventType,
    metrics:
      row.metricsJson === null
        ? null
        : auditSourceApiActionMetricsSchema.parse(row.metricsJson),
    originActor,
    originSurface: row.originSurface,
    outcome: row.outcome as AuditOutcome,
    phase: row.phase as AuditSourceApiActionPhase,
    preview,
    requestId,
    startedAt: row.startedAt.toISOString(),
    subtitle: row.subtitle,
    target,
    title: row.title,
  };
}

async function loadAuditFeedRequestIds(input: {
  db: DatabaseExecutor;
  organizationId: string;
  rows: readonly (typeof auditFeedEntries.$inferSelect)[];
}) {
  const familyActionIds = [
    ...new Set(input.rows.map((row) => row.familyActionId)),
  ];
  const families = [...new Set(input.rows.map((row) => row.family))];

  if (familyActionIds.length === 0 || families.length === 0) {
    return new Map<string, string | null>();
  }

  const commandRows = await input.db
    .select({
      family: workflowJournal.family,
      requestId: workflowJournal.requestId,
      streamId: workflowJournal.streamId,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.entryKind, "command"),
        eq(workflowJournal.organizationId, input.organizationId),
        inArray(workflowJournal.family, families),
        inArray(workflowJournal.streamId, familyActionIds)
      )
    )
    .orderBy(
      asc(workflowJournal.family),
      asc(workflowJournal.streamId),
      asc(workflowJournal.streamPosition),
      asc(workflowJournal.id)
    );

  const requestIds = new Map<string, string | null>();
  for (const row of commandRows) {
    const key = `${row.family}:${row.streamId}`;
    if (!requestIds.has(key)) {
      requestIds.set(key, row.requestId);
    }
  }

  return requestIds;
}

export async function listAuditFeedPage(input: {
  db: Database;
  organizationId: string;
  params: AuditListParams;
}): Promise<AuditListResponse> {
  await syncAuditFeedProjection(input.db);
  const checkpointSnapshot = await loadAuditProjectionCheckpointSnapshot(
    input.db
  );
  const projectedThrough = serializeAuditProjectedThrough(checkpointSnapshot);
  const projectionLag = await loadAuditProjectionLag(
    input.db,
    normalizeAuditProjectionCheckpointSnapshot(checkpointSnapshot),
    input.organizationId
  );
  const conditions = [
    eq(auditFeedEntries.organizationId, input.organizationId),
  ];

  if (input.params.family) {
    conditions.push(eq(auditFeedEntries.family, input.params.family));
  }

  if (input.params.actionName) {
    conditions.push(eq(auditFeedEntries.actionName, input.params.actionName));
  }

  if (input.params.outcome) {
    conditions.push(eq(auditFeedEntries.outcome, input.params.outcome));
  }

  if (input.params.sourceKey) {
    conditions.push(
      buildCaseInsensitiveEquals(
        sql`${auditFeedEntries.targetJson} ->> 'sourceKey'`,
        input.params.sourceKey
      )
    );
  }

  if (input.params.q) {
    conditions.push(
      buildCaseInsensitiveContains(
        auditFeedEntries.searchDocument,
        input.params.q
      )
    );
  }

  if (input.params.cursor) {
    const cursor = decodeAuditCursor(input.params.cursor);
    if (!cursor) {
      throw new InvalidAuditCursorError();
    }

    const cursorCondition = or(
      lt(auditFeedEntries.startedAt, cursor.startedAt),
      and(
        eq(auditFeedEntries.startedAt, cursor.startedAt),
        or(
          lt(auditFeedEntries.family, cursor.family),
          and(
            eq(auditFeedEntries.family, cursor.family),
            lt(auditFeedEntries.familyActionId, cursor.familyActionId)
          )
        )
      )
    );

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }

  const rows = await input.db
    .select()
    .from(auditFeedEntries)
    .where(and(...conditions))
    .orderBy(
      desc(auditFeedEntries.startedAt),
      desc(auditFeedEntries.family),
      desc(auditFeedEntries.familyActionId)
    )
    .limit(input.params.limit + 1);

  const pageRows = rows.slice(0, input.params.limit);
  const lastRow = pageRows.at(-1);
  const requestIds = await loadAuditFeedRequestIds({
    db: input.db,
    organizationId: input.organizationId,
    rows: pageRows,
  });
  const items = pageRows.map((row) =>
    serializeAuditFeedItem(
      row,
      requestIds.get(`${row.family}:${row.familyActionId}`) ?? null
    )
  );
  const families = [...new Set(items.map((item) => item.family))];

  return auditListResponseSchema.parse({
    families,
    items,
    nextCursor:
      rows.length > input.params.limit && lastRow
        ? encodeAuditCursor({
            family: lastRow.family,
            familyActionId: lastRow.familyActionId,
            startedAt: lastRow.startedAt,
          })
        : null,
    projectionLag,
    projectedThrough,
  });
}
