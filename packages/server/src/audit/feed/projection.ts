import {
  and,
  asc,
  auditFeedEntries,
  auditProjectionCheckpoints,
  eq,
  gt,
  inArray,
  lt,
  queryActionEvents,
  sourceApiActionEvents,
  sql,
  workflowCommands,
} from "@onequery/db/server";
import type {
  Database,
  WorkflowFamily,
  WorkflowProjectionJson,
} from "@onequery/db/server";

import {
  AUDIT_FEED_PROJECTION_NAME,
  AUDIT_PROJECTION_BATCH_SIZE,
  AUDIT_PROJECTION_MAX_BATCHES_PER_REQUEST,
} from "./constants";
import {
  createQueryActionRowFromStart,
  parseStoredQueryActionRow,
  reduceQueryActionRow,
} from "./query-action-projection";
import {
  createSourceApiActionRowFromStart,
  parseStoredSourceApiActionRow,
  reduceSourceApiActionRow,
} from "./source-api-action-projection";
import type {
  AuditProjectionRow,
  DatabaseExecutor,
  QueryActionProjectionRow,
  SourceApiActionProjectionRow,
} from "./types";

async function loadAuditCheckpoint(
  db: DatabaseExecutor,
  family: WorkflowFamily
) {
  const [checkpoint] = await db
    .select({
      lastCommitPosition: auditProjectionCheckpoints.lastCommitPosition,
    })
    .from(auditProjectionCheckpoints)
    .where(
      and(
        eq(auditProjectionCheckpoints.family, family),
        eq(
          auditProjectionCheckpoints.projectionName,
          AUDIT_FEED_PROJECTION_NAME
        )
      )
    )
    .limit(1);

  return checkpoint?.lastCommitPosition ?? 0n;
}

async function loadAuditFeedRowsByActionId(
  db: DatabaseExecutor,
  family: WorkflowFamily,
  familyActionIds: readonly string[]
) {
  if (familyActionIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(auditFeedEntries)
    .where(
      and(
        eq(auditFeedEntries.family, family),
        inArray(auditFeedEntries.familyActionId, [...familyActionIds])
      )
    );
}

async function loadQueryActionEventBatch(
  db: DatabaseExecutor,
  lastCommitPosition: bigint,
  limit: number
) {
  return db
    .select({
      actionId: queryActionEvents.actionId,
      actorSnapshotJson: workflowCommands.actorSnapshotJson,
      commandId: workflowCommands.id,
      commandPayloadBytes: workflowCommands.commandPayloadBytes,
      commandType: workflowCommands.commandType,
      commitPosition: queryActionEvents.commitPosition,
      eventId: queryActionEvents.id,
      eventType: queryActionEvents.eventType,
      occurredAt: queryActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadBytes: queryActionEvents.payloadBytes,
      sequence: queryActionEvents.sequence,
      surface: workflowCommands.surface,
    })
    .from(queryActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, queryActionEvents.commandId)
    )
    .where(gt(queryActionEvents.commitPosition, lastCommitPosition))
    .orderBy(asc(queryActionEvents.commitPosition))
    .limit(limit);
}

async function loadSourceApiActionEventBatch(
  db: DatabaseExecutor,
  lastCommitPosition: bigint,
  limit: number
) {
  return db
    .select({
      actionId: sourceApiActionEvents.actionId,
      actorSnapshotJson: workflowCommands.actorSnapshotJson,
      commandId: workflowCommands.id,
      commandPayloadBytes: workflowCommands.commandPayloadBytes,
      commandType: workflowCommands.commandType,
      commitPosition: sourceApiActionEvents.commitPosition,
      eventId: sourceApiActionEvents.id,
      eventType: sourceApiActionEvents.eventType,
      occurredAt: sourceApiActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadBytes: sourceApiActionEvents.payloadBytes,
      sequence: sourceApiActionEvents.sequence,
      surface: workflowCommands.surface,
    })
    .from(sourceApiActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, sourceApiActionEvents.commandId)
    )
    .where(gt(sourceApiActionEvents.commitPosition, lastCommitPosition))
    .orderBy(asc(sourceApiActionEvents.commitPosition))
    .limit(limit);
}

async function rebuildQueryActionRow(
  db: DatabaseExecutor,
  actionId: string,
  throughCommitPosition: bigint
) {
  const eventRows = await db
    .select({
      actionId: queryActionEvents.actionId,
      actorSnapshotJson: workflowCommands.actorSnapshotJson,
      commandId: workflowCommands.id,
      commandPayloadBytes: workflowCommands.commandPayloadBytes,
      commandType: workflowCommands.commandType,
      commitPosition: queryActionEvents.commitPosition,
      eventId: queryActionEvents.id,
      eventType: queryActionEvents.eventType,
      occurredAt: queryActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadBytes: queryActionEvents.payloadBytes,
      sequence: queryActionEvents.sequence,
      surface: workflowCommands.surface,
    })
    .from(queryActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, queryActionEvents.commandId)
    )
    .where(
      and(
        eq(queryActionEvents.actionId, actionId),
        lt(queryActionEvents.commitPosition, throughCommitPosition + 1n)
      )
    )
    .orderBy(asc(queryActionEvents.commitPosition));

  let row: QueryActionProjectionRow | null = null;
  for (const eventRow of eventRows) {
    row =
      row === null
        ? createQueryActionRowFromStart(eventRow)
        : reduceQueryActionRow(row, eventRow);
  }

  if (row === null) {
    throw new Error(`query_action ${actionId} could not be rebuilt`);
  }

  return row;
}

async function rebuildSourceApiActionRow(
  db: DatabaseExecutor,
  actionId: string,
  throughCommitPosition: bigint
) {
  const eventRows = await db
    .select({
      actionId: sourceApiActionEvents.actionId,
      actorSnapshotJson: workflowCommands.actorSnapshotJson,
      commandId: workflowCommands.id,
      commandPayloadBytes: workflowCommands.commandPayloadBytes,
      commandType: workflowCommands.commandType,
      commitPosition: sourceApiActionEvents.commitPosition,
      eventId: sourceApiActionEvents.id,
      eventType: sourceApiActionEvents.eventType,
      occurredAt: sourceApiActionEvents.occurredAt,
      organizationId: workflowCommands.organizationId,
      payloadBytes: sourceApiActionEvents.payloadBytes,
      sequence: sourceApiActionEvents.sequence,
      surface: workflowCommands.surface,
    })
    .from(sourceApiActionEvents)
    .innerJoin(
      workflowCommands,
      eq(workflowCommands.id, sourceApiActionEvents.commandId)
    )
    .where(
      and(
        eq(sourceApiActionEvents.actionId, actionId),
        lt(sourceApiActionEvents.commitPosition, throughCommitPosition + 1n)
      )
    )
    .orderBy(asc(sourceApiActionEvents.commitPosition));

  let row: SourceApiActionProjectionRow | null = null;
  for (const eventRow of eventRows) {
    row =
      row === null
        ? createSourceApiActionRowFromStart(eventRow)
        : reduceSourceApiActionRow(row, eventRow);
  }

  if (row === null) {
    throw new Error(`source_api_action ${actionId} could not be rebuilt`);
  }

  return row;
}

async function upsertAuditFeedRow(
  db: DatabaseExecutor,
  row: AuditProjectionRow
) {
  const previewJson = row.preview as WorkflowProjectionJson;
  const metricsJson = row.metrics as WorkflowProjectionJson | null;

  await db
    .insert(auditFeedEntries)
    .values({
      actionName: row.actionName,
      completedAt: row.completedAt,
      failureCode: row.failureCode,
      family: row.family,
      familyActionId: row.familyActionId,
      familyPreviewJson: previewJson,
      lastProjectedSequence: row.lastProjectedSequence,
      lastEventAt: row.lastEventAt,
      lastEventType: row.lastEventType,
      metricsJson,
      organizationId: row.organizationId,
      originActorJson: row.originActor as WorkflowProjectionJson,
      originSurface: row.originSurface,
      outcome: row.outcome,
      phase: row.phase,
      searchDocument: row.searchDocument,
      startedAt: row.startedAt,
      subtitle: row.subtitle,
      targetJson: row.target as WorkflowProjectionJson,
      title: row.title,
    })
    .onConflictDoUpdate({
      set: {
        actionName: row.actionName,
        completedAt: row.completedAt,
        failureCode: row.failureCode,
        familyPreviewJson: previewJson,
        lastProjectedSequence: row.lastProjectedSequence,
        lastEventAt: row.lastEventAt,
        lastEventType: row.lastEventType,
        metricsJson,
        organizationId: row.organizationId,
        originActorJson: row.originActor as WorkflowProjectionJson,
        originSurface: row.originSurface,
        outcome: row.outcome,
        phase: row.phase,
        searchDocument: row.searchDocument,
        startedAt: row.startedAt,
        subtitle: row.subtitle,
        targetJson: row.target as WorkflowProjectionJson,
        title: row.title,
      },
      setWhere: sql`${auditFeedEntries.lastProjectedSequence} < ${sql.raw("excluded.last_projected_sequence")}`,
      target: [auditFeedEntries.family, auditFeedEntries.familyActionId],
    });
}

async function advanceQueryActionProjectionBatch(db: DatabaseExecutor) {
  const lastCommitPosition = await loadAuditCheckpoint(db, "query_action");
  const eventRows = await loadQueryActionEventBatch(
    db,
    lastCommitPosition,
    AUDIT_PROJECTION_BATCH_SIZE
  );

  if (eventRows.length === 0) {
    return false;
  }

  const familyActionIds = [...new Set(eventRows.map((row) => row.actionId))];
  const storedRows = await loadAuditFeedRowsByActionId(
    db,
    "query_action",
    familyActionIds
  );
  const projectionRows = new Map<string, QueryActionProjectionRow>();

  for (const storedRow of storedRows) {
    try {
      projectionRows.set(
        storedRow.familyActionId,
        parseStoredQueryActionRow(storedRow)
      );
    } catch {
      projectionRows.set(
        storedRow.familyActionId,
        await rebuildQueryActionRow(
          db,
          storedRow.familyActionId,
          lastCommitPosition
        )
      );
    }
  }

  for (const eventRow of eventRows) {
    const existingRow = projectionRows.get(eventRow.actionId);
    if (existingRow === undefined) {
      const rebuiltRow =
        eventRow.sequence === 1
          ? createQueryActionRowFromStart(eventRow)
          : await rebuildQueryActionRow(
              db,
              eventRow.actionId,
              eventRow.commitPosition
            );
      projectionRows.set(eventRow.actionId, rebuiltRow);
      continue;
    }

    projectionRows.set(
      eventRow.actionId,
      reduceQueryActionRow(existingRow, eventRow)
    );
  }

  for (const projectionRow of projectionRows.values()) {
    await upsertAuditFeedRow(db, projectionRow);
  }

  const maxCommitPosition =
    eventRows[eventRows.length - 1]?.commitPosition ?? lastCommitPosition;

  await db
    .insert(auditProjectionCheckpoints)
    .values({
      family: "query_action",
      lastCommitPosition: maxCommitPosition,
      projectionName: AUDIT_FEED_PROJECTION_NAME,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      set: {
        lastCommitPosition: sql`greatest(${auditProjectionCheckpoints.lastCommitPosition}, ${maxCommitPosition})`,
        updatedAt: new Date(),
      },
      target: [
        auditProjectionCheckpoints.projectionName,
        auditProjectionCheckpoints.family,
      ],
    });

  return true;
}

async function advanceSourceApiActionProjectionBatch(db: DatabaseExecutor) {
  const lastCommitPosition = await loadAuditCheckpoint(db, "source_api_action");
  const eventRows = await loadSourceApiActionEventBatch(
    db,
    lastCommitPosition,
    AUDIT_PROJECTION_BATCH_SIZE
  );

  if (eventRows.length === 0) {
    return false;
  }

  const familyActionIds = [...new Set(eventRows.map((row) => row.actionId))];
  const storedRows = await loadAuditFeedRowsByActionId(
    db,
    "source_api_action",
    familyActionIds
  );
  const projectionRows = new Map<string, SourceApiActionProjectionRow>();

  for (const storedRow of storedRows) {
    try {
      projectionRows.set(
        storedRow.familyActionId,
        parseStoredSourceApiActionRow(storedRow)
      );
    } catch {
      projectionRows.set(
        storedRow.familyActionId,
        await rebuildSourceApiActionRow(
          db,
          storedRow.familyActionId,
          lastCommitPosition
        )
      );
    }
  }

  for (const eventRow of eventRows) {
    const existingRow = projectionRows.get(eventRow.actionId);
    if (existingRow === undefined) {
      const rebuiltRow =
        eventRow.sequence === 1
          ? createSourceApiActionRowFromStart(eventRow)
          : await rebuildSourceApiActionRow(
              db,
              eventRow.actionId,
              eventRow.commitPosition
            );
      projectionRows.set(eventRow.actionId, rebuiltRow);
      continue;
    }

    projectionRows.set(
      eventRow.actionId,
      reduceSourceApiActionRow(existingRow, eventRow)
    );
  }

  for (const projectionRow of projectionRows.values()) {
    await upsertAuditFeedRow(db, projectionRow);
  }

  const maxCommitPosition =
    eventRows[eventRows.length - 1]?.commitPosition ?? lastCommitPosition;

  await db
    .insert(auditProjectionCheckpoints)
    .values({
      family: "source_api_action",
      lastCommitPosition: maxCommitPosition,
      projectionName: AUDIT_FEED_PROJECTION_NAME,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      set: {
        lastCommitPosition: sql`greatest(${auditProjectionCheckpoints.lastCommitPosition}, ${maxCommitPosition})`,
        updatedAt: new Date(),
      },
      target: [
        auditProjectionCheckpoints.projectionName,
        auditProjectionCheckpoints.family,
      ],
    });

  return true;
}

export async function syncAuditFeedProjection(db: Database): Promise<void> {
  for (
    let batchIndex = 0;
    batchIndex < AUDIT_PROJECTION_MAX_BATCHES_PER_REQUEST;
    batchIndex += 1
  ) {
    const queryAdvanced = await db.transaction((tx) =>
      advanceQueryActionProjectionBatch(tx)
    );
    const sourceAdvanced = await db.transaction((tx) =>
      advanceSourceApiActionProjectionBatch(tx)
    );

    if (!queryAdvanced && !sourceAdvanced) {
      break;
    }
  }
}
