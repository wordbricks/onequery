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
  inArray,
  queryActions,
  sourceApiActions,
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

const REJECTED_DECISION_CHECKPOINT = "decision_rejected";

type CommandDecision =
  | {
      decisionKind: "accepted";
      rejectCode: null;
      rejectDetail: null;
    }
  | {
      decisionKind: "rejected";
      rejectCode: string;
      rejectDetail: string | null;
    };

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

function decodeJsonCheckpointPayload(input: {
  label: string;
  payloadBytes: Buffer | Uint8Array;
}): unknown {
  try {
    return JSON.parse(Buffer.from(input.payloadBytes).toString("utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${input.label} has invalid JSON payload: ${message}`, {
      cause: error,
    });
  }
}

function serializeRejectedCommandDecision(
  row: typeof workflowJournal.$inferSelect
): CommandDecision {
  const payload = decodeJsonCheckpointPayload({
    label: `workflow_journal checkpoint ${row.id}`,
    payloadBytes: requireJournalValue(
      row.payloadBytes,
      `workflow_journal checkpoint ${row.id} payload`
    ),
  });

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("rejectCode" in payload)
  ) {
    throw new Error(
      `workflow_journal checkpoint ${row.id} has invalid rejected decision payload`
    );
  }

  const rejectCode = payload.rejectCode;
  const rejectDetail = "rejectDetail" in payload ? payload.rejectDetail : null;
  if (
    typeof rejectCode !== "string" ||
    (rejectDetail !== null && typeof rejectDetail !== "string")
  ) {
    throw new Error(
      `workflow_journal checkpoint ${row.id} has invalid rejected decision fields`
    );
  }

  return {
    decisionKind: "rejected",
    rejectCode,
    rejectDetail,
  };
}

function serializeCommand(
  row: typeof workflowJournal.$inferSelect,
  decision: CommandDecision
) {
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
    decisionKind: decision.decisionKind,
    id: row.id,
    rejectCode: decision.rejectCode,
    rejectDetail: decision.rejectDetail,
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

  if (rows.length === 0) {
    return [];
  }

  // Comment: Rejected command decisions are stored as checkpoint rows appended
  // in the same commit as the command, not as columns on the command row.
  const rejectedDecisionRows = await input.db
    .select()
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.entryKind, "checkpoint"),
        eq(workflowJournal.family, input.family),
        eq(workflowJournal.organizationId, input.organizationId),
        eq(workflowJournal.streamId, input.actionId),
        eq(workflowJournal.payloadType, REJECTED_DECISION_CHECKPOINT),
        inArray(
          workflowJournal.commitId,
          rows.map((row) => row.commitId)
        )
      )
    )
    .orderBy(asc(workflowJournal.streamPosition), asc(workflowJournal.id));
  const rejectedDecisionByCommitId = new Map(
    rejectedDecisionRows.map((row) => [
      row.commitId,
      serializeRejectedCommandDecision(row),
    ])
  );
  const acceptedDecision: CommandDecision = {
    decisionKind: "accepted",
    rejectCode: null,
    rejectDetail: null,
  };

  return rows.map((row) =>
    serializeCommand(
      row,
      rejectedDecisionByCommitId.get(row.commitId) ?? acceptedDecision
    )
  );
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
  await syncAuditFeedProjection(input.db, { family: input.family });

  if (input.family === "query_action") {
    return loadQueryActionDetail(input);
  }

  return loadSourceApiActionDetail(input);
}
