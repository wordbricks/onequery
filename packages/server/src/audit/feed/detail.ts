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
  queryActionEvents,
  queryActions,
  sourceApiActionEvents,
  sourceApiActions,
  workflowCommands,
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

function serializeCommand(row: typeof workflowCommands.$inferSelect) {
  return {
    actor: auditOriginActorSchema.parse(row.actorSnapshotJson),
    causedByEventId: row.causedByEventId,
    commandInvocationId: row.commandInvocationId,
    commandPayload: serializeBytes(row.commandPayloadBytes),
    commandType: row.commandType,
    createdAt: row.createdAt.toISOString(),
    decodedPayload: serializeDecodedPayload({
      bytes: row.commandPayloadBytes,
      entity: "command",
      family: row.family,
    }),
    decisionKind: row.decisionKind,
    id: row.id,
    rejectCode: row.rejectCode,
    rejectDetail: row.rejectDetail,
    requestId: row.requestId,
    surface: row.surface,
  };
}

function serializeQueryEvent(row: typeof queryActionEvents.$inferSelect) {
  return {
    commandId: row.commandId,
    commitPosition: row.commitPosition.toString(),
    eventType: row.eventType,
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    payload: serializeBytes(row.payloadBytes),
    decodedPayload: serializeDecodedPayload({
      bytes: row.payloadBytes,
      entity: "event",
      family: "query_action",
    }),
    sequence: row.sequence,
  };
}

function serializeSourceApiEvent(
  row: typeof sourceApiActionEvents.$inferSelect
) {
  return {
    commandId: row.commandId,
    commitPosition: row.commitPosition.toString(),
    eventType: row.eventType,
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    payload: serializeBytes(row.payloadBytes),
    decodedPayload: serializeDecodedPayload({
      bytes: row.payloadBytes,
      entity: "event",
      family: "source_api_action",
    }),
    sequence: row.sequence,
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
    .from(workflowCommands)
    .where(
      and(
        eq(workflowCommands.actionId, input.actionId),
        eq(workflowCommands.family, input.family),
        eq(workflowCommands.organizationId, input.organizationId)
      )
    )
    .orderBy(asc(workflowCommands.createdAt), asc(workflowCommands.id));

  return rows.map(serializeCommand);
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
    input.db
      .select()
      .from(queryActionEvents)
      .where(eq(queryActionEvents.actionId, input.actionId))
      .orderBy(asc(queryActionEvents.sequence))
      .then((rows) => rows.map(serializeQueryEvent)),
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
    input.db
      .select()
      .from(sourceApiActionEvents)
      .where(eq(sourceApiActionEvents.actionId, input.actionId))
      .orderBy(asc(sourceApiActionEvents.sequence))
      .then((rows) => rows.map(serializeSourceApiEvent)),
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
