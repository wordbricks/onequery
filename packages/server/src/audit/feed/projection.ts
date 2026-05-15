import {
  and,
  asc,
  auditFeedEntries,
  auditProjectionCheckpoints,
  eq,
  gt,
  inArray,
  lt,
  sql,
  workflowJournal,
} from "@onequery/db/server";
import type {
  Database,
  WorkflowActorSnapshotJson,
  WorkflowFamily,
  WorkflowProjectionJson,
  WorkflowSurface,
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

type JournalEventRow = {
  actionId: string;
  commitId: string;
  commitPosition: bigint;
  eventId: string | null;
  eventType: string | null;
  occurredAt: Date;
  organizationId: string;
  payloadBytes: Buffer | null;
};

type JournalCommandRow = {
  actorSnapshotJson: WorkflowActorSnapshotJson | null;
  commandId: string;
  commandPayloadBytes: Buffer | null;
  commandType: string | null;
  commitId: string;
  surface: WorkflowSurface | null;
};

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
  const rows = await db
    .select({
      actionId: workflowJournal.streamId,
      commitId: workflowJournal.commitId,
      commitPosition: workflowJournal.commitPosition,
      eventId: workflowJournal.eventId,
      eventType: workflowJournal.eventType,
      occurredAt: workflowJournal.occurredAt,
      organizationId: workflowJournal.organizationId,
      payloadBytes: workflowJournal.payloadBytes,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, "query_action"),
        eq(workflowJournal.entryKind, "event"),
        gt(workflowJournal.commitPosition, lastCommitPosition)
      )
    )
    .orderBy(asc(workflowJournal.commitPosition))
    .limit(limit);

  return hydrateQueryActionEventRows(db, rows, lastCommitPosition);
}

async function loadSourceApiActionEventBatch(
  db: DatabaseExecutor,
  lastCommitPosition: bigint,
  limit: number
) {
  const rows = await db
    .select({
      actionId: workflowJournal.streamId,
      commitId: workflowJournal.commitId,
      commitPosition: workflowJournal.commitPosition,
      eventId: workflowJournal.eventId,
      eventType: workflowJournal.eventType,
      occurredAt: workflowJournal.occurredAt,
      organizationId: workflowJournal.organizationId,
      payloadBytes: workflowJournal.payloadBytes,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, "source_api_action"),
        eq(workflowJournal.entryKind, "event"),
        gt(workflowJournal.commitPosition, lastCommitPosition)
      )
    )
    .orderBy(asc(workflowJournal.commitPosition))
    .limit(limit);

  return hydrateSourceApiActionEventRows(db, rows, lastCommitPosition);
}

async function hydrateQueryActionEventRows(
  db: DatabaseExecutor,
  rows: readonly JournalEventRow[],
  previousCommitPosition: bigint
) {
  return hydrateJournalEventRows(
    db,
    "query_action",
    rows,
    previousCommitPosition
  );
}

async function hydrateSourceApiActionEventRows(
  db: DatabaseExecutor,
  rows: readonly JournalEventRow[],
  previousCommitPosition: bigint
) {
  return hydrateJournalEventRows(
    db,
    "source_api_action",
    rows,
    previousCommitPosition
  );
}

async function hydrateJournalEventRows(
  db: DatabaseExecutor,
  family: WorkflowFamily,
  rows: readonly JournalEventRow[],
  previousCommitPosition: bigint
) {
  if (rows.length === 0) {
    return [];
  }

  const actionIds = [...new Set(rows.map((row) => row.actionId))];
  const commitIds = [...new Set(rows.map((row) => row.commitId))];
  const [commands, sequenceOffsets] = await Promise.all([
    loadJournalCommandRows(db, family, commitIds),
    loadJournalEventSequenceOffsets(
      db,
      family,
      actionIds,
      previousCommitPosition
    ),
  ]);
  const commandByCommitId = new Map(
    commands.map((command) => [command.commitId, command])
  );
  const sequenceByActionId = new Map(sequenceOffsets);

  return rows.map((row) => {
    const command = commandByCommitId.get(row.commitId);
    if (command === undefined) {
      throw new Error(
        `${family} journal event ${row.eventId ?? row.commitId} has no command entry`
      );
    }

    const nextSequence = (sequenceByActionId.get(row.actionId) ?? 0) + 1;
    sequenceByActionId.set(row.actionId, nextSequence);

    return {
      actionId: row.actionId,
      actorSnapshotJson: requireJournalValue(
        command.actorSnapshotJson,
        `${family} command ${command.commandId} actor snapshot`
      ),
      commandId: command.commandId,
      commandPayloadBytes: requireJournalValue(
        command.commandPayloadBytes,
        `${family} command ${command.commandId} payload`
      ),
      commandType: requireJournalValue(
        command.commandType,
        `${family} command ${command.commandId} type`
      ),
      commitPosition: row.commitPosition,
      eventId: requireJournalValue(row.eventId, `${family} journal event id`),
      eventType: requireJournalValue(
        row.eventType,
        `${family} journal event type`
      ),
      occurredAt: row.occurredAt,
      organizationId: row.organizationId,
      payloadBytes: requireJournalValue(
        row.payloadBytes,
        `${family} journal event payload`
      ),
      sequence: nextSequence,
      surface: requireJournalValue(
        command.surface,
        `${family} command ${command.commandId} surface`
      ),
    };
  });
}

async function loadJournalCommandRows(
  db: DatabaseExecutor,
  family: WorkflowFamily,
  commitIds: readonly string[]
): Promise<JournalCommandRow[]> {
  if (commitIds.length === 0) {
    return [];
  }

  return db
    .select({
      actorSnapshotJson: workflowJournal.actorSnapshotJson,
      commandId: workflowJournal.id,
      commandPayloadBytes: workflowJournal.payloadBytes,
      commandType: workflowJournal.payloadType,
      commitId: workflowJournal.commitId,
      surface: workflowJournal.surface,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, family),
        eq(workflowJournal.entryKind, "command"),
        inArray(workflowJournal.commitId, [...commitIds])
      )
    );
}

async function loadJournalEventSequenceOffsets(
  db: DatabaseExecutor,
  family: WorkflowFamily,
  actionIds: readonly string[],
  previousCommitPosition: bigint
): Promise<Array<[string, number]>> {
  if (actionIds.length === 0 || previousCommitPosition === 0n) {
    return [];
  }

  const rows = await db
    .select({
      actionId: workflowJournal.streamId,
      count: sql<number>`count(*)::int`,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, family),
        eq(workflowJournal.entryKind, "event"),
        inArray(workflowJournal.streamId, [...actionIds]),
        lt(workflowJournal.commitPosition, previousCommitPosition + 1n)
      )
    )
    .groupBy(workflowJournal.streamId);

  return rows.map((row) => [row.actionId, row.count]);
}

function requireJournalValue<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new Error(`missing ${label}`);
  }

  return value;
}

async function rebuildQueryActionRow(
  db: DatabaseExecutor,
  actionId: string,
  throughCommitPosition: bigint
) {
  const rows = await db
    .select({
      actionId: workflowJournal.streamId,
      commitId: workflowJournal.commitId,
      commitPosition: workflowJournal.commitPosition,
      eventId: workflowJournal.eventId,
      eventType: workflowJournal.eventType,
      occurredAt: workflowJournal.occurredAt,
      organizationId: workflowJournal.organizationId,
      payloadBytes: workflowJournal.payloadBytes,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, "query_action"),
        eq(workflowJournal.entryKind, "event"),
        eq(workflowJournal.streamId, actionId),
        lt(workflowJournal.commitPosition, throughCommitPosition + 1n)
      )
    )
    .orderBy(asc(workflowJournal.commitPosition));
  const eventRows = await hydrateQueryActionEventRows(db, rows, 0n);

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
  const rows = await db
    .select({
      actionId: workflowJournal.streamId,
      commitId: workflowJournal.commitId,
      commitPosition: workflowJournal.commitPosition,
      eventId: workflowJournal.eventId,
      eventType: workflowJournal.eventType,
      occurredAt: workflowJournal.occurredAt,
      organizationId: workflowJournal.organizationId,
      payloadBytes: workflowJournal.payloadBytes,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, "source_api_action"),
        eq(workflowJournal.entryKind, "event"),
        eq(workflowJournal.streamId, actionId),
        lt(workflowJournal.commitPosition, throughCommitPosition + 1n)
      )
    )
    .orderBy(asc(workflowJournal.commitPosition));
  const eventRows = await hydrateSourceApiActionEventRows(db, rows, 0n);

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

export async function syncAuditFeedProjection(
  db: Database,
  options: { family?: WorkflowFamily } = {}
): Promise<void> {
  for (
    let batchIndex = 0;
    batchIndex < AUDIT_PROJECTION_MAX_BATCHES_PER_REQUEST;
    batchIndex += 1
  ) {
    const queryAdvanced =
      options.family === undefined || options.family === "query_action"
        ? await db.transaction((tx) => advanceQueryActionProjectionBatch(tx))
        : false;
    const sourceAdvanced =
      options.family === undefined || options.family === "source_api_action"
        ? await db.transaction((tx) =>
            advanceSourceApiActionProjectionBatch(tx)
          )
        : false;

    if (!queryAdvanced && !sourceAdvanced) {
      break;
    }
  }
}
