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
  AuditListQuery,
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
  auditFeedEntries,
  auditProjectionCheckpoints,
  desc,
  eq,
  gt,
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
  row: typeof auditFeedEntries.$inferSelect
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
    startedAt: row.startedAt.toISOString(),
    subtitle: row.subtitle,
    target,
    title: row.title,
  };
}

export async function listAuditFeedPage(input: {
  db: Database;
  organizationId: string;
  query: AuditListQuery;
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

  if (input.query.family) {
    conditions.push(eq(auditFeedEntries.family, input.query.family));
  }

  if (input.query.actionName) {
    conditions.push(eq(auditFeedEntries.actionName, input.query.actionName));
  }

  if (input.query.outcome) {
    conditions.push(eq(auditFeedEntries.outcome, input.query.outcome));
  }

  if (input.query.sourceKey) {
    conditions.push(
      buildCaseInsensitiveEquals(
        sql`${auditFeedEntries.targetJson} ->> 'sourceKey'`,
        input.query.sourceKey
      )
    );
  }

  if (input.query.q) {
    conditions.push(
      buildCaseInsensitiveContains(
        auditFeedEntries.searchDocument,
        input.query.q
      )
    );
  }

  if (input.query.cursor) {
    const cursor = decodeAuditCursor(input.query.cursor);
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
    .limit(input.query.limit + 1);

  const pageRows = rows.slice(0, input.query.limit);
  const lastRow = pageRows.at(-1);
  const items = pageRows.map(serializeAuditFeedItem);
  const families = [...new Set(items.map((item) => item.family))];

  return auditListResponseSchema.parse({
    families,
    items,
    nextCursor:
      rows.length > input.query.limit && lastRow
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
