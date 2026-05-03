import { toJson } from "@bufbuild/protobuf";
import type { DescMessage, JsonValue, MessageShape } from "@bufbuild/protobuf";
import {
  auditActionDetailSchema,
  auditOriginActorSchema,
} from "@onequery/audit-contracts/audit";
import type {
  AuditActionDetail,
  AuditFamily,
} from "@onequery/audit-contracts/audit";
import {
  and,
  asc,
  auditFeedEntries,
  eq,
  queryActions,
  sourceApiActions,
  inArray,
  workflowJournal,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import {
  QueryActionCommandPayloadSchema,
  QueryActionEventPayloadSchema,
} from "@onequery/proto-workflow/workflow/v1/query_action_pb";
import {
  SourceApiActionCommandPayloadSchema,
  SourceApiActionEventPayloadSchema,
} from "@onequery/proto-workflow/workflow/v1/source_api_action_pb";

import { serializeAuditFeedItem } from "./list";
import { syncAuditFeedProjection } from "./projection";
import { decodeValidatedAuditFeedPayload } from "./workflow-payload-codec";

function serializeBytes(bytes: Buffer | Uint8Array) {
  const buffer = Buffer.from(bytes);

  return {
    base64: buffer.toString("base64"),
    byteLength: buffer.byteLength,
  };
}

function decodeJsonPayload<Schema extends DescMessage>(
  schema: Schema,
  bytes: Buffer | Uint8Array
): JsonValue {
  const decoded = decodeValidatedAuditFeedPayload(
    schema,
    Buffer.from(bytes)
  ) as MessageShape<Schema>;
  return toJson(schema, decoded);
}

function serializeDecodedPayload(input: {
  bytes: Buffer | Uint8Array;
  entity: "command" | "event";
  family: AuditFamily;
}) {
  try {
    if (input.family === "query_action") {
      return decodeJsonPayload(
        input.entity === "command"
          ? QueryActionCommandPayloadSchema
          : QueryActionEventPayloadSchema,
        input.bytes
      );
    }

    return decodeJsonPayload(
      input.entity === "command"
        ? SourceApiActionCommandPayloadSchema
        : SourceApiActionEventPayloadSchema,
      input.bytes
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Comment: Detail reads should still expose raw bytes when an old or corrupt
    // row cannot be decoded with the current protobuf schema.
    return {
      decodeError: message,
    };
  }
}

function requireJournalValue<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new Error(`missing ${label}`);
  }

  return value;
}

function serializeCommand(row: typeof workflowJournal.$inferSelect) {
  const commandType = requireJournalValue(
    row.payloadType,
    `workflow_journal command ${row.id} payload type`
  );
  const payloadBytes = requireJournalValue(
    row.payloadBytes,
    `workflow_journal command ${row.id} payload`
  );

  return {
    actor: auditOriginActorSchema.parse(
      requireJournalValue(
        row.actorSnapshotJson,
        `workflow_journal command ${row.id} actor snapshot`
      )
    ),
    causedByEventId: row.causedByEventId,
    commandInvocationId: requireJournalValue(
      row.commandInvocationId,
      `workflow_journal command ${row.id} invocation id`
    ),
    commandPayload: serializeBytes(payloadBytes),
    commandType,
    createdAt: row.occurredAt.toISOString(),
    decodedPayload: serializeDecodedPayload({
      bytes: payloadBytes,
      entity: "command",
      family: row.family,
    }),
    decisionKind: "accepted",
    id: row.id,
    rejectCode: null,
    rejectDetail: null,
    requestId: requireJournalValue(
      row.requestId,
      `workflow_journal command ${row.id} request id`
    ),
    surface: requireJournalValue(
      row.surface,
      `workflow_journal command ${row.id} surface`
    ),
  };
}

function serializeEvent(input: {
  commandId: string;
  family: AuditFamily;
  row: typeof workflowJournal.$inferSelect;
  sequence: number;
}) {
  const eventType = requireJournalValue(
    input.row.eventType,
    `workflow_journal event ${input.row.id} event type`
  );
  const payloadBytes = requireJournalValue(
    input.row.payloadBytes,
    `workflow_journal event ${input.row.id} payload`
  );

  return {
    commandId: input.commandId,
    commitPosition: input.row.commitPosition.toString(),
    eventType,
    id: requireJournalValue(
      input.row.eventId,
      `workflow_journal event ${input.row.id} event id`
    ),
    occurredAt: input.row.occurredAt.toISOString(),
    payload: serializeBytes(payloadBytes),
    decodedPayload: serializeDecodedPayload({
      bytes: payloadBytes,
      entity: "event",
      family: input.family,
    }),
    sequence: input.sequence,
  };
}

async function loadCommands(input: {
  actionId: string;
  db: Database;
  family: AuditFamily;
  organizationId: string;
}) {
  const rows = await input.db
    .select()
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.entryKind, "command"),
        eq(workflowJournal.family, input.family),
        eq(workflowJournal.organizationId, input.organizationId),
        eq(workflowJournal.streamId, input.actionId)
      )
    )
    .orderBy(asc(workflowJournal.streamPosition), asc(workflowJournal.id));

  return rows.map(serializeCommand);
}

async function loadEvents(input: {
  actionId: string;
  db: Database;
  family: AuditFamily;
  organizationId: string;
}) {
  const rows = await input.db
    .select()
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.entryKind, "event"),
        eq(workflowJournal.family, input.family),
        eq(workflowJournal.organizationId, input.organizationId),
        eq(workflowJournal.streamId, input.actionId)
      )
    )
    .orderBy(asc(workflowJournal.streamPosition), asc(workflowJournal.id));

  if (rows.length === 0) {
    return [];
  }

  const commitIds = [...new Set(rows.map((row) => row.commitId))];
  const commandRows = await input.db
    .select({
      commitId: workflowJournal.commitId,
      id: workflowJournal.id,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.entryKind, "command"),
        eq(workflowJournal.family, input.family),
        eq(workflowJournal.organizationId, input.organizationId),
        eq(workflowJournal.streamId, input.actionId),
        inArray(workflowJournal.commitId, commitIds)
      )
    );
  const commandIdByCommitId = new Map(
    commandRows.map((row) => [row.commitId, row.id])
  );

  return rows.map((row, index) =>
    serializeEvent({
      commandId: requireJournalValue(
        commandIdByCommitId.get(row.commitId) ?? null,
        `workflow_journal event ${row.id} command`
      ),
      family: input.family,
      row,
      sequence: index + 1,
    })
  );
}

async function loadFeedEntry(input: {
  actionId: string;
  db: Database;
  family: AuditFamily;
  organizationId: string;
}) {
  const [row] = await input.db
    .select()
    .from(auditFeedEntries)
    .where(
      and(
        eq(auditFeedEntries.familyActionId, input.actionId),
        eq(auditFeedEntries.family, input.family),
        eq(auditFeedEntries.organizationId, input.organizationId)
      )
    )
    .limit(1);

  return row ? serializeAuditFeedItem(row) : null;
}

async function loadQueryActionDetail(input: {
  actionId: string;
  db: Database;
  organizationId: string;
}) {
  const [action] = await input.db
    .select()
    .from(queryActions)
    .where(
      and(
        eq(queryActions.id, input.actionId),
        eq(queryActions.organizationId, input.organizationId)
      )
    )
    .limit(1);

  if (!action) {
    return null;
  }

  const [commands, events, feedEntry] = await Promise.all([
    loadCommands({
      actionId: input.actionId,
      db: input.db,
      family: "query_action",
      organizationId: input.organizationId,
    }),
    loadEvents({
      actionId: input.actionId,
      db: input.db,
      family: "query_action",
      organizationId: input.organizationId,
    }),
    loadFeedEntry({
      actionId: input.actionId,
      db: input.db,
      family: "query_action",
      organizationId: input.organizationId,
    }),
  ]);

  if (!feedEntry) {
    return null;
  }

  return auditActionDetailSchema.parse({
    action: {
      completedAt: action.completedAt?.toISOString() ?? null,
      failureCode: action.failureCode,
      id: action.id,
      lastEventId: action.lastEventId,
      lastEventSequence: action.lastEventSequence,
      outcome: action.outcome,
      phase: action.phase,
      queryMode: action.queryMode,
      queryText: action.queryText,
      sourceDescriptor: action.sourceDescriptorJson ?? null,
      startedAt: action.startedAt.toISOString(),
      usageRecordingStatus: action.usageRecordingStatus,
      validatedQuery: action.validatedQuery,
    },
    commands,
    events,
    family: "query_action",
    feedEntry,
  });
}

async function loadSourceApiActionDetail(input: {
  actionId: string;
  db: Database;
  organizationId: string;
}) {
  const [action] = await input.db
    .select()
    .from(sourceApiActions)
    .where(
      and(
        eq(sourceApiActions.id, input.actionId),
        eq(sourceApiActions.organizationId, input.organizationId)
      )
    )
    .limit(1);

  if (!action) {
    return null;
  }

  const [commands, events, feedEntry] = await Promise.all([
    loadCommands({
      actionId: input.actionId,
      db: input.db,
      family: "source_api_action",
      organizationId: input.organizationId,
    }),
    loadEvents({
      actionId: input.actionId,
      db: input.db,
      family: "source_api_action",
      organizationId: input.organizationId,
    }),
    loadFeedEntry({
      actionId: input.actionId,
      db: input.db,
      family: "source_api_action",
      organizationId: input.organizationId,
    }),
  ]);

  if (!feedEntry) {
    return null;
  }

  return auditActionDetailSchema.parse({
    action: {
      attemptNumber: action.attemptNumber,
      completedAt: action.completedAt?.toISOString() ?? null,
      failureCode: action.failureCode,
      id: action.id,
      invokeMode: action.invokeMode,
      lastEventId: action.lastEventId,
      lastEventSequence: action.lastEventSequence,
      outcome: action.outcome,
      pageProgress: action.pageProgressJson ?? null,
      phase: action.phase,
      preparedRequestFingerprint: action.preparedRequestFingerprint,
      requestDescriptor: action.requestDescriptorJson ?? null,
      requestKind: action.requestKind,
      sourceDescriptor: action.sourceDescriptorJson ?? null,
      startedAt: action.startedAt.toISOString(),
    },
    commands,
    events,
    family: "source_api_action",
    feedEntry,
  });
}

export async function getAuditActionDetail(input: {
  actionId: string;
  db: Database;
  family: AuditFamily;
  organizationId: string;
}): Promise<AuditActionDetail | null> {
  await syncAuditFeedProjection(input.db);

  if (input.family === "query_action") {
    return loadQueryActionDetail(input);
  }

  return loadSourceApiActionDetail(input);
}
