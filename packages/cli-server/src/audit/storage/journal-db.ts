import { and, asc, desc, eq, workflowJournal } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import type { Result as ResultType } from "better-result";

import type { WorkflowFamily } from "../kernel";
import { WorkflowJournalCorruptStreamError } from "./journal";
import type {
  WorkflowJournalCheckpointEntry,
  WorkflowJournalCommandEntry,
  WorkflowJournalEffectCompletedEntry,
  WorkflowJournalEffectFailedEntry,
  WorkflowJournalEffectScheduledEntry,
  WorkflowJournalEffectStartedEntry,
  WorkflowJournalEntry,
  WorkflowJournalEntryKind,
  WorkflowJournalEventEntry,
  WorkflowJournalStore,
} from "./journal";
import type { DatabaseTransaction } from "./types";

type WorkflowJournalRow = typeof workflowJournal.$inferSelect;
type WorkflowJournalInsert = typeof workflowJournal.$inferInsert;
type JournalExecutor = Database | DatabaseTransaction;

export type WorkflowJournalPayloadCodecContext = {
  commandInvocationId?: string;
  commitId: string;
  entryId: string;
  family: WorkflowFamily;
  kind: WorkflowJournalEntryKind;
  organizationId: string;
  payloadType: string;
  streamId: string;
  streamPosition: number;
};

type MaybeResult<T> = T | ResultType<T, unknown>;

// Comment: workflow_journal has one payload_bytes column and no dedicated
// columns for worker IDs, failure details, or checkpoint payloads, so this
// adapter stores those journal-only fields as small local JSON payloads.
export type WorkflowJournalPayloadCodec<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
> = {
  decodeCheckpointPayload?: (
    bytes: Buffer,
    context: WorkflowJournalPayloadCodecContext
  ) => MaybeResult<unknown>;
  decodeCommandPayload: (
    bytes: Buffer,
    context: WorkflowJournalPayloadCodecContext
  ) => MaybeResult<CommandPayload>;
  decodeEffectPayload: (
    bytes: Buffer,
    context: WorkflowJournalPayloadCodecContext
  ) => MaybeResult<Effect>;
  decodeEventPayload: (
    bytes: Buffer,
    context: WorkflowJournalPayloadCodecContext
  ) => MaybeResult<Event>;
  encodeCheckpointPayload?: (
    payload: unknown,
    context: WorkflowJournalPayloadCodecContext
  ) => Buffer;
  encodeCommandPayload: (
    payload: CommandPayload,
    context: WorkflowJournalPayloadCodecContext
  ) => Buffer;
  encodeEffectPayload: (
    payload: Effect,
    context: WorkflowJournalPayloadCodecContext
  ) => Buffer;
  encodeEventPayload: (
    payload: Event,
    context: WorkflowJournalPayloadCodecContext
  ) => Buffer;
};

export function createDbWorkflowJournalStore<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(input: {
  codec: WorkflowJournalPayloadCodec<CommandPayload, Event, Effect>;
  db: Database;
  onAppendEntries?: (input: {
    entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[];
    expectedStreamPosition: number;
    tx: DatabaseTransaction;
  }) => Promise<void>;
}): WorkflowJournalStore<CommandPayload, Event, Effect> {
  const { codec, db, onAppendEntries } = input;

  return {
    appendEntries: async (appendInput) => {
      const firstEntry = appendInput.entries[0];
      if (firstEntry === undefined) {
        return {
          kind: "appended",
        };
      }

      const commandEntry = findCommandEntry(appendInput.entries);

      try {
        return await db.transaction(async (tx) => {
          if (commandEntry !== undefined) {
            const existingCommand = await loadCommandRow(tx, {
              commandInvocationId: commandEntry.commandInvocationId,
              family: commandEntry.family,
            });

            if (existingCommand !== null) {
              return {
                entries: await loadCommitEntries(tx, codec, existingCommand),
                kind: "command_conflict",
              };
            }
          }

          const currentStreamPosition = await loadCurrentStreamPosition(tx, {
            family: firstEntry.family,
            streamId: firstEntry.streamId,
          });

          if (currentStreamPosition !== appendInput.expectedStreamPosition) {
            return {
              currentStreamPosition,
              kind: "position_conflict",
            };
          }

          assertAppendBatchShape({
            entries: appendInput.entries,
            expectedStreamPosition: appendInput.expectedStreamPosition,
          });

          await tx
            .insert(workflowJournal)
            .values(
              appendInput.entries.map((entry) =>
                toWorkflowJournalInsert(entry, codec)
              )
            );

          await onAppendEntries?.({
            entries: appendInput.entries,
            expectedStreamPosition: appendInput.expectedStreamPosition,
            tx,
          });

          return {
            kind: "appended",
          };
        });
      } catch (error: unknown) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        if (commandEntry !== undefined) {
          const conflictEntries = await loadEntriesByCommandInvocation(
            db,
            codec,
            {
              commandInvocationId: commandEntry.commandInvocationId,
              family: commandEntry.family,
            }
          );
          if (conflictEntries !== null) {
            return {
              entries: conflictEntries,
              kind: "command_conflict",
            };
          }
        }

        const currentStreamPosition = await loadCurrentStreamPosition(db, {
          family: firstEntry.family,
          streamId: firstEntry.streamId,
        });
        if (currentStreamPosition !== appendInput.expectedStreamPosition) {
          return {
            currentStreamPosition,
            kind: "position_conflict",
          };
        }

        throw error;
      }
    },
    loadEntriesByCommandInvocation: (loadInput) =>
      loadEntriesByCommandInvocation(db, codec, loadInput),
    loadStream: async (loadInput) => {
      const rows = await db
        .select()
        .from(workflowJournal)
        .where(
          and(
            eq(workflowJournal.family, loadInput.family),
            eq(workflowJournal.streamId, loadInput.streamId)
          )
        )
        .orderBy(asc(workflowJournal.streamPosition), asc(workflowJournal.id));

      return rows.map((row) => toWorkflowJournalEntry(row, codec));
    },
  };
}

async function loadEntriesByCommandInvocation<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(
  db: JournalExecutor,
  codec: WorkflowJournalPayloadCodec<CommandPayload, Event, Effect>,
  input: {
    commandInvocationId: string;
    family: WorkflowFamily;
  }
): Promise<
  readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[] | null
> {
  const commandRow = await loadCommandRow(db, input);
  if (commandRow === null) {
    return null;
  }

  return loadCommitEntries(db, codec, commandRow);
}

async function loadCommandRow(
  db: JournalExecutor,
  input: {
    commandInvocationId: string;
    family: WorkflowFamily;
  }
) {
  const rows = await db
    .select()
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, input.family),
        eq(workflowJournal.entryKind, "command"),
        eq(workflowJournal.commandInvocationId, input.commandInvocationId)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

async function loadCommitEntries<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(
  db: JournalExecutor,
  codec: WorkflowJournalPayloadCodec<CommandPayload, Event, Effect>,
  commandRow: WorkflowJournalRow
) {
  const rows = await db
    .select()
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, commandRow.family),
        eq(workflowJournal.streamId, commandRow.streamId),
        eq(workflowJournal.commitId, commandRow.commitId)
      )
    )
    .orderBy(asc(workflowJournal.streamPosition), asc(workflowJournal.id));

  return rows.map((row) => toWorkflowJournalEntry(row, codec));
}

async function loadCurrentStreamPosition(
  db: JournalExecutor,
  input: {
    family: WorkflowFamily;
    streamId: string;
  }
) {
  const rows = await db
    .select({
      streamPosition: workflowJournal.streamPosition,
    })
    .from(workflowJournal)
    .where(
      and(
        eq(workflowJournal.family, input.family),
        eq(workflowJournal.streamId, input.streamId)
      )
    )
    .orderBy(desc(workflowJournal.streamPosition))
    .limit(1);

  return rows[0]?.streamPosition ?? 0;
}

function toWorkflowJournalInsert<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(
  entry: WorkflowJournalEntry<CommandPayload, Event, Effect>,
  codec: WorkflowJournalPayloadCodec<CommandPayload, Event, Effect>
): WorkflowJournalInsert {
  const base = {
    commitId: entry.commitId,
    entryKind: entry.kind,
    family: entry.family,
    id: entry.entryId,
    occurredAt: entry.occurredAt,
    organizationId: entry.organizationId,
    streamId: entry.streamId,
    streamPosition: entry.streamPosition,
  };

  switch (entry.kind) {
    case "command": {
      const context = payloadContext(entry, entry.commandType);
      return {
        ...base,
        actorSnapshotJson:
          entry.actorSnapshot === undefined
            ? null
            : {
                authMode: entry.actorSnapshot.authMode,
                email: entry.actorSnapshot.email,
                membershipRoles: [...entry.actorSnapshot.membershipRoles],
                userId: entry.actorSnapshot.userId,
              },
        causedByEventId: entry.causedByEventId ?? null,
        commandInvocationId: entry.commandInvocationId,
        payloadBytes: codec.encodeCommandPayload(entry.commandPayload, context),
        payloadType: entry.commandType,
        requestId: entry.requestId ?? null,
        surface: entry.surface ?? null,
      };
    }
    case "event": {
      const context = payloadContext(entry, entry.eventType);
      return {
        ...base,
        eventId: entry.eventId,
        eventType: entry.eventType,
        payloadBytes: codec.encodeEventPayload(entry.event, context),
        payloadType: entry.eventType,
      };
    }
    case "effect_scheduled": {
      const context = payloadContext(entry, entry.effectType);
      return {
        ...base,
        effectId: entry.effectId,
        effectType: entry.effectType,
        payloadBytes: codec.encodeEffectPayload(entry.effect, context),
        payloadType: entry.effectType,
      };
    }
    case "effect_started":
      return {
        ...base,
        effectId: entry.effectId,
        payloadBytes: encodeJsonPayload({
          workerId: entry.workerId,
        }),
        payloadType: "effect_started",
      };
    case "effect_completed":
      return {
        ...base,
        effectId: entry.effectId,
        payloadBytes: encodeJsonPayload({}),
        payloadType: "effect_completed",
      };
    case "effect_failed":
      return {
        ...base,
        effectId: entry.effectId,
        payloadBytes: encodeJsonPayload({
          errorCode: entry.errorCode,
          errorDetail: entry.errorDetail,
        }),
        payloadType: "effect_failed",
      };
    case "checkpoint": {
      const context = payloadContext(entry, entry.checkpointName);
      return {
        ...base,
        payloadBytes: encodeCheckpointPayload(
          codec,
          entry.checkpointPayload,
          context
        ),
        payloadType: entry.checkpointName,
      };
    }
  }
}

function toWorkflowJournalEntry<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(
  row: WorkflowJournalRow,
  codec: WorkflowJournalPayloadCodec<CommandPayload, Event, Effect>
): WorkflowJournalEntry<CommandPayload, Event, Effect> {
  const base = {
    commitId: row.commitId,
    entryId: row.id,
    family: row.family,
    kind: row.entryKind,
    occurredAt: row.occurredAt,
    organizationId: row.organizationId,
    streamId: row.streamId,
    streamPosition: row.streamPosition,
  };

  switch (row.entryKind) {
    case "command": {
      const commandInvocationId = requireRowText(
        row,
        row.commandInvocationId,
        "command_invocation_id"
      );
      const commandType = requireRowText(row, row.payloadType, "payload_type");
      const payloadBytes = requirePayloadBytes(row);
      const context = rowPayloadContext(row, commandType, {
        commandInvocationId,
      });
      return {
        ...base,
        ...(row.actorSnapshotJson === null
          ? {}
          : { actorSnapshot: row.actorSnapshotJson }),
        ...(row.causedByEventId === null
          ? {}
          : { causedByEventId: row.causedByEventId }),
        commandInvocationId,
        commandPayload: unwrapDecoded(
          codec.decodeCommandPayload(payloadBytes, context)
        ),
        commandType,
        kind: "command",
        ...(row.requestId === null ? {} : { requestId: row.requestId }),
        ...(row.surface === null ? {} : { surface: row.surface }),
      } satisfies WorkflowJournalCommandEntry<CommandPayload>;
    }
    case "event": {
      const eventId = requireRowText(row, row.eventId, "event_id");
      const eventType = requireRowText(row, row.eventType, "event_type");
      const payloadType = requireRowText(row, row.payloadType, "payload_type");
      const payloadBytes = requirePayloadBytes(row);
      return {
        ...base,
        event: unwrapDecoded(
          codec.decodeEventPayload(
            payloadBytes,
            rowPayloadContext(row, payloadType)
          )
        ),
        eventId,
        eventType,
        kind: "event",
      } satisfies WorkflowJournalEventEntry<Event>;
    }
    case "effect_scheduled": {
      const effectId = requireRowText(row, row.effectId, "effect_id");
      const effectType = requireRowText(row, row.effectType, "effect_type");
      const payloadType = requireRowText(row, row.payloadType, "payload_type");
      const payloadBytes = requirePayloadBytes(row);
      return {
        ...base,
        effect: unwrapDecoded(
          codec.decodeEffectPayload(
            payloadBytes,
            rowPayloadContext(row, payloadType)
          )
        ),
        effectId,
        effectType,
        kind: "effect_scheduled",
      } satisfies WorkflowJournalEffectScheduledEntry<Effect>;
    }
    case "effect_started": {
      const effectId = requireRowText(row, row.effectId, "effect_id");
      const payload =
        decodeJsonPayload<WorkflowJournalEffectStartedPayload>(row);
      return {
        ...base,
        effectId,
        kind: "effect_started",
        workerId: payload.workerId ?? null,
      } satisfies WorkflowJournalEffectStartedEntry;
    }
    case "effect_completed": {
      const effectId = requireRowText(row, row.effectId, "effect_id");
      return {
        ...base,
        effectId,
        kind: "effect_completed",
      } satisfies WorkflowJournalEffectCompletedEntry;
    }
    case "effect_failed": {
      const effectId = requireRowText(row, row.effectId, "effect_id");
      const payload =
        decodeJsonPayload<WorkflowJournalEffectFailedPayload>(row);
      return {
        ...base,
        effectId,
        errorCode: requirePayloadText(row, payload.errorCode, "errorCode"),
        errorDetail: payload.errorDetail ?? null,
        kind: "effect_failed",
      } satisfies WorkflowJournalEffectFailedEntry;
    }
    case "checkpoint": {
      const checkpointName = requireRowText(
        row,
        row.payloadType,
        "payload_type"
      );
      const payloadBytes = requirePayloadBytes(row);
      const context = rowPayloadContext(row, checkpointName);
      return {
        ...base,
        checkpointName,
        checkpointPayload: decodeCheckpointPayload(
          codec,
          payloadBytes,
          context
        ),
        kind: "checkpoint",
      } satisfies WorkflowJournalCheckpointEntry;
    }
    default:
      throw corruptRow(
        row,
        `unsupported workflow journal entry kind ${String(row.entryKind)}`
      );
  }
}

function assertAppendBatchShape<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(input: {
  entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[];
  expectedStreamPosition: number;
}) {
  const firstEntry = input.entries[0];
  if (firstEntry === undefined) {
    return;
  }

  let streamPosition = input.expectedStreamPosition;
  let commandCount = 0;

  for (const entry of input.entries) {
    if (
      entry.family !== firstEntry.family ||
      entry.streamId !== firstEntry.streamId ||
      entry.commitId !== firstEntry.commitId
    ) {
      throw new WorkflowJournalCorruptStreamError({
        detail:
          "workflow journal append batch must contain one family, stream, and commit",
        entryId: entry.entryId,
        family: entry.family,
        streamId: entry.streamId,
      });
    }

    if (entry.kind === "command") {
      commandCount += 1;
    }

    if (entry.streamPosition !== streamPosition + 1) {
      throw new WorkflowJournalCorruptStreamError({
        detail: `workflow journal append entry ${entry.entryId} is at position ${entry.streamPosition}, expected ${streamPosition + 1}`,
        entryId: entry.entryId,
        family: entry.family,
        streamId: entry.streamId,
      });
    }

    streamPosition = entry.streamPosition;
  }

  if (commandCount > 1) {
    throw new WorkflowJournalCorruptStreamError({
      detail: "workflow journal append batch cannot contain multiple commands",
      entryId: firstEntry.entryId,
      family: firstEntry.family,
      streamId: firstEntry.streamId,
    });
  }
}

function findCommandEntry<
  CommandPayload extends { type: string },
  Event extends { type: string },
  Effect extends { type: string },
>(entries: readonly WorkflowJournalEntry<CommandPayload, Event, Effect>[]) {
  return entries.find(
    (entry): entry is WorkflowJournalCommandEntry<CommandPayload> =>
      entry.kind === "command"
  );
}

function payloadContext(
  entry: WorkflowJournalEntry<
    { type: string },
    { type: string },
    { type: string }
  >,
  payloadType: string
): WorkflowJournalPayloadCodecContext {
  return {
    ...(entry.kind === "command"
      ? { commandInvocationId: entry.commandInvocationId }
      : {}),
    commitId: entry.commitId,
    entryId: entry.entryId,
    family: entry.family,
    kind: entry.kind,
    organizationId: entry.organizationId,
    payloadType,
    streamId: entry.streamId,
    streamPosition: entry.streamPosition,
  };
}

function rowPayloadContext(
  row: WorkflowJournalRow,
  payloadType: string,
  extra: {
    commandInvocationId?: string;
  } = {}
): WorkflowJournalPayloadCodecContext {
  return {
    ...extra,
    commitId: row.commitId,
    entryId: row.id,
    family: row.family,
    kind: row.entryKind,
    organizationId: row.organizationId,
    payloadType,
    streamId: row.streamId,
    streamPosition: row.streamPosition,
  };
}

function encodeCheckpointPayload(
  codec: Pick<
    WorkflowJournalPayloadCodec<
      { type: string },
      { type: string },
      { type: string }
    >,
    "encodeCheckpointPayload"
  >,
  payload: unknown,
  context: WorkflowJournalPayloadCodecContext
) {
  return (
    codec.encodeCheckpointPayload?.(payload, context) ??
    encodeJsonPayload(payload)
  );
}

function decodeCheckpointPayload(
  codec: Pick<
    WorkflowJournalPayloadCodec<
      { type: string },
      { type: string },
      { type: string }
    >,
    "decodeCheckpointPayload"
  >,
  bytes: Buffer,
  context: WorkflowJournalPayloadCodecContext
) {
  return codec.decodeCheckpointPayload === undefined
    ? decodeJsonBytes(bytes, context)
    : unwrapDecoded(codec.decodeCheckpointPayload(bytes, context));
}

function encodeJsonPayload(value: unknown): Buffer {
  const json = JSON.stringify(value);
  return Buffer.from(json === undefined ? "null" : json, "utf8");
}

function decodeJsonPayload<T>(row: WorkflowJournalRow): T {
  return decodeJsonBytes(
    requirePayloadBytes(row),
    rowPayloadContext(row, "json")
  ) as T;
}

function decodeJsonBytes(
  bytes: Buffer,
  context: WorkflowJournalPayloadCodecContext
) {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error: unknown) {
    throw new WorkflowJournalCorruptStreamError({
      detail: `workflow journal entry ${context.entryId} has invalid JSON payload: ${String(error)}`,
      entryId: context.entryId,
      family: context.family,
      streamId: context.streamId,
    });
  }
}

function requirePayloadBytes(row: WorkflowJournalRow): Buffer {
  if (row.payloadBytes === null) {
    throw corruptRow(row, "workflow journal row is missing payload_bytes");
  }

  return row.payloadBytes;
}

function requireRowText(
  row: WorkflowJournalRow,
  value: string | null,
  columnName: string
): string {
  if (value === null) {
    throw corruptRow(row, `workflow journal row is missing ${columnName}`);
  }

  return value;
}

function requirePayloadText(
  row: WorkflowJournalRow,
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== "string") {
    throw corruptRow(
      row,
      `workflow journal row payload is missing ${fieldName}`
    );
  }

  return value;
}

function unwrapDecoded<T>(decoded: MaybeResult<T>): T {
  if (!isResult(decoded)) {
    return decoded;
  }

  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

function isResult<T>(value: MaybeResult<T>): value is ResultType<T, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "isErr" in value &&
    typeof value.isErr === "function" &&
    "isOk" in value &&
    typeof value.isOk === "function"
  );
}

function corruptRow(row: WorkflowJournalRow, detail: string) {
  return new WorkflowJournalCorruptStreamError({
    detail,
    entryId: row.id,
    family: row.family,
    streamId: row.streamId,
  });
}

function isUniqueViolation(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
  };
  if (maybeError.code === "23505") {
    return true;
  }

  const message =
    typeof maybeError.message === "string" ? maybeError.message : "";
  return (
    message.includes("duplicate key") ||
    message.includes("unique constraint") ||
    message.includes("UNIQUE constraint")
  );
}

type WorkflowJournalEffectStartedPayload = {
  workerId?: string | null;
};

type WorkflowJournalEffectFailedPayload = {
  errorCode?: unknown;
  errorDetail?: string | null;
};
