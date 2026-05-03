import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  asc,
  createDb,
  organization,
  prepareApplicationDatabase,
  workflowJournal,
} from "@onequery/db/server";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";
import { afterEach, describe, expect, it } from "vitest";

import { appendWorkflowJournalBatch } from "./journal";
import type {
  WorkflowJournalCommandEntry,
  WorkflowJournalCursor,
  WorkflowJournalEffectFailedEntry,
  WorkflowJournalEffectScheduledEntry,
  WorkflowJournalEffectStartedEntry,
  WorkflowJournalEntry,
  WorkflowJournalEventEntry,
  WorkflowJournalStore,
} from "./journal";
import { createDbWorkflowJournalStore } from "./journal-db";

type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

type TestCommand =
  | {
      name: string;
      type: "start";
    }
  | {
      name: string;
      type: "record";
    }
  | {
      type: "effect_result";
    };

type TestEvent =
  | {
      name: string;
      type: "started";
    }
  | {
      name: string;
      type: "prepared";
    };

type TestEffect =
  | {
      name: string;
      type: "prepare";
    }
  | {
      name: string;
      type: "persist";
    };

type TestState = {
  eventCount: number;
  lastEventId: string;
  name: string;
  phase: "started" | "prepared";
};

class TestReduceError extends Error {}

type TestStore = WorkflowJournalStore<TestCommand, TestEvent, TestEffect>;

const migrationsFolder = fileURLToPath(
  new URL("../../../../db/src/migrations", import.meta.url)
);

const occurredAt = new Date("2026-04-20T07:12:00.000Z");

async function closeDatabase(db: ClosableDatabase): Promise<void> {
  const client = db.$client;
  if (client && typeof client.close === "function") {
    await client.close();
    return;
  }

  if (client && typeof client.end === "function") {
    await client.end({ timeout: 0 });
  }
}

async function createTestDb() {
  const connectionString = `pglite:${join(tmpdir(), "pglite", randomUUID())}`;
  await prepareApplicationDatabase({
    connectionString,
    migrationsFolder,
  });
  const db = createDb(connectionString);

  await db.insert(organization).values({
    id: "org_1",
    name: "Org One",
    slug: "org-one",
  });

  return db;
}

function createTestStore(db: ReturnType<typeof createDb>): TestStore {
  return createDbWorkflowJournalStore<TestCommand, TestEvent, TestEffect>({
    codec: {
      decodeCommandPayload: (bytes) => decodeJsonPayload<TestCommand>(bytes),
      decodeEffectPayload: (bytes) => decodeJsonPayload<TestEffect>(bytes),
      decodeEventPayload: (bytes) => decodeJsonPayload<TestEvent>(bytes),
      encodeCommandPayload: encodeJsonPayload,
      encodeEffectPayload: encodeJsonPayload,
      encodeEventPayload: encodeJsonPayload,
    },
    db,
  });
}

function encodeJsonPayload(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function decodeJsonPayload<T>(bytes: Buffer): ResultType<T, Error> {
  try {
    return Result.ok(JSON.parse(bytes.toString("utf8")) as T);
  } catch (cause: unknown) {
    return Result.err(new Error("invalid test JSON payload", { cause }));
  }
}

function reduceTestState(
  state: TestState | null,
  entry: WorkflowJournalEventEntry<TestEvent>
): ResultType<TestState, TestReduceError> {
  switch (entry.event.type) {
    case "started":
      return Result.ok({
        eventCount: 1,
        lastEventId: entry.eventId,
        name: entry.event.name,
        phase: "started",
      });
    case "prepared":
      if (state === null) {
        return Result.err(new TestReduceError("prepared without start"));
      }

      return Result.ok({
        ...state,
        eventCount: state.eventCount + 1,
        lastEventId: entry.eventId,
        name: entry.event.name,
        phase: "prepared",
      });
  }
}

function appendTestBatch(
  store: TestStore,
  input: {
    checkpoints?: Parameters<
      typeof appendWorkflowJournalBatch
    >[0]["checkpoints"];
    commandInvocationId: string;
    commandPayload: TestCommand;
    effectFailures?: Parameters<
      typeof appendWorkflowJournalBatch
    >[0]["effectFailures"];
    effectStarts?: Parameters<
      typeof appendWorkflowJournalBatch
    >[0]["effectStarts"];
    effects?: readonly TestEffect[];
    events?: readonly TestEvent[];
    expectedStreamPosition: number;
    currentCursor?: WorkflowJournalCursor<
      TestState,
      TestCommand,
      TestEvent,
      TestEffect
    >;
    skipStorePreflightChecks?: boolean;
    streamId?: string;
  }
) {
  return appendWorkflowJournalBatch({
    checkpoints: input.checkpoints,
    commandInvocationId: input.commandInvocationId,
    commandPayload: input.commandPayload,
    currentCursor: input.currentCursor,
    effectFailures: input.effectFailures,
    effectStarts: input.effectStarts,
    effects: input.effects,
    events: input.events,
    expectedStreamPosition: input.expectedStreamPosition,
    family: "query_action",
    occurredAt,
    organizationId: "org_1",
    reduce: reduceTestState,
    skipStorePreflightChecks: input.skipStorePreflightChecks,
    store,
    streamId: input.streamId ?? "action_1",
  });
}

function unwrap<T, TError extends Error>(result: ResultType<T, TError>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

function expectSingle<T>(values: readonly T[]): T {
  expect(values).toHaveLength(1);
  const value = values[0];
  if (value === undefined) {
    throw new Error("expected one value");
  }

  return value;
}

function emptyCursor(
  streamId: string
): WorkflowJournalCursor<TestState, TestCommand, TestEvent, TestEffect> {
  return {
    checkpoint: null,
    commands: [],
    effects: [],
    events: [],
    pendingEffects: [],
    state: null,
    streamId,
    streamPosition: 0,
  };
}

function buildManualCommandEntry(input: {
  commandInvocationId: string;
  commitId: string;
  entryId: string;
  streamPosition: number;
}): WorkflowJournalCommandEntry<TestCommand> {
  return {
    commandInvocationId: input.commandInvocationId,
    commandPayload: {
      name: "manual",
      type: "record",
    },
    commandType: "record",
    commitId: input.commitId,
    entryId: input.entryId,
    family: "query_action",
    kind: "command",
    occurredAt,
    organizationId: "org_1",
    streamId: "action_1",
    streamPosition: input.streamPosition,
  };
}

function buildManualEventEntry(input: {
  commitId: string;
  entryId: string;
  eventId: string;
  streamPosition: number;
}): WorkflowJournalEventEntry<TestEvent> {
  return {
    commitId: input.commitId,
    entryId: input.entryId,
    event: {
      name: "manual",
      type: "prepared",
    },
    eventId: input.eventId,
    eventType: "prepared",
    family: "query_action",
    kind: "event",
    occurredAt,
    organizationId: "org_1",
    streamId: "action_1",
    streamPosition: input.streamPosition,
  };
}

describe("DB workflow journal store", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("appends and loads typed journal entries through PGlite", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);
    const store = createTestStore(db);

    const started = unwrap(
      await appendTestBatch(store, {
        checkpoints: [
          {
            checkpointName: "started",
            checkpointPayload: {
              phase: "started",
            },
          },
        ],
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "query",
          type: "start",
        },
        effects: [
          {
            name: "query",
            type: "prepare",
          },
        ],
        events: [
          {
            name: "query",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
      })
    );
    const effect = expectSingle(started.freshEffects);

    const failed = unwrap(
      await appendTestBatch(store, {
        checkpoints: [
          {
            checkpointName: "failed",
            checkpointPayload: {
              errorCode: "temporary_failure",
            },
          },
        ],
        commandInvocationId: "cmd-fail",
        commandPayload: {
          type: "effect_result",
        },
        effectFailures: [
          {
            effectId: effect.effectId,
            errorCode: "temporary_failure",
            errorDetail: "retry later",
          },
        ],
        effectStarts: [
          {
            effectId: effect.effectId,
            workerId: "worker_1",
          },
        ],
        expectedStreamPosition: started.cursor.streamPosition,
      })
    );

    const byCommand = await store.loadEntriesByCommandInvocation({
      commandInvocationId: "cmd-start",
      family: "query_action",
    });
    const stream = await store.loadStream({
      family: "query_action",
      streamId: "action_1",
    });
    const rawRows = await db
      .select()
      .from(workflowJournal)
      .orderBy(asc(workflowJournal.streamPosition), asc(workflowJournal.id));

    expect(byCommand?.map((entry) => entry.kind)).toEqual([
      "command",
      "event",
      "effect_scheduled",
      "checkpoint",
    ]);
    expect(stream.map((entry) => entry.kind)).toEqual([
      "command",
      "event",
      "effect_scheduled",
      "checkpoint",
      "command",
      "effect_started",
      "effect_failed",
      "checkpoint",
    ]);
    expect(stream.map((entry) => entry.streamPosition)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(failed.cursor.streamPosition).toBe(8);

    const commandEntry = stream.find(
      (entry): entry is WorkflowJournalCommandEntry<TestCommand> =>
        entry.kind === "command" && entry.commandInvocationId === "cmd-start"
    );
    const eventEntry = stream.find(
      (entry): entry is WorkflowJournalEventEntry<TestEvent> =>
        entry.kind === "event"
    );
    const effectEntry = stream.find(
      (entry): entry is WorkflowJournalEffectScheduledEntry<TestEffect> =>
        entry.kind === "effect_scheduled"
    );
    const startEntry = stream.find(
      (entry): entry is WorkflowJournalEffectStartedEntry =>
        entry.kind === "effect_started"
    );
    const failedEntry = stream.find(
      (entry): entry is WorkflowJournalEffectFailedEntry =>
        entry.kind === "effect_failed"
    );
    const checkpointEntry = stream.at(-1);

    expect(commandEntry?.commandPayload).toEqual({
      name: "query",
      type: "start",
    });
    expect(eventEntry?.event).toEqual({
      name: "query",
      type: "started",
    });
    expect(effectEntry?.effect).toEqual({
      name: "query",
      type: "prepare",
    });
    expect(startEntry?.workerId).toBe("worker_1");
    expect(failedEntry).toMatchObject({
      errorCode: "temporary_failure",
      errorDetail: "retry later",
    });
    expect(checkpointEntry).toMatchObject({
      checkpointName: "failed",
      checkpointPayload: {
        errorCode: "temporary_failure",
      },
      kind: "checkpoint",
    });

    expect(rawRows).toHaveLength(stream.length);
    expect(rawRows.every((row) => Buffer.isBuffer(row.payloadBytes))).toBe(
      true
    );
    expect(rawRows.map((row) => row.payloadType)).toEqual([
      "start",
      "started",
      "prepare",
      "started",
      "effect_result",
      "effect_started",
      "effect_failed",
      "failed",
    ]);
  });

  it("returns existing commit entries on command idempotency conflicts", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);
    const store = createTestStore(db);

    const started = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "query",
          type: "start",
        },
        events: [
          {
            name: "query",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
      })
    );

    const conflict = await store.appendEntries({
      entries: [
        buildManualCommandEntry({
          commandInvocationId: "cmd-start",
          commitId: "commit-conflict",
          entryId: "entry-conflict-command",
          streamPosition: 100,
        }),
      ],
      expectedStreamPosition: 99,
    });
    const stream = await store.loadStream({
      family: "query_action",
      streamId: "action_1",
    });

    expect(conflict.kind).toBe("command_conflict");
    if (conflict.kind !== "command_conflict") {
      throw new Error("expected command conflict");
    }
    expect(conflict.entries.map((entry) => entry.entryId)).toEqual(
      started.entries.map((entry) => entry.entryId)
    );
    expect(stream.map((entry) => entry.entryId)).toEqual(
      started.entries.map((entry) => entry.entryId)
    );
  });

  it("replays optimistic fresh-stream appends on command idempotency conflicts", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);
    const store = createTestStore(db);

    const started = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "query",
          type: "start",
        },
        currentCursor: emptyCursor("action_1"),
        events: [
          {
            name: "query",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
        skipStorePreflightChecks: true,
        streamId: "action_1",
      })
    );

    const replay = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "ignored",
          type: "start",
        },
        currentCursor: emptyCursor("action_2"),
        events: [
          {
            name: "ignored",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
        skipStorePreflightChecks: true,
        streamId: "action_2",
      })
    );
    const replayStream = await store.loadStream({
      family: "query_action",
      streamId: "action_2",
    });

    expect(replay.idempotency).toBe("replayed");
    expect(replay.cursor.streamId).toBe("action_1");
    expect(replay.entries.map((entry) => entry.entryId)).toEqual(
      started.entries.map((entry) => entry.entryId)
    );
    expect(replayStream).toEqual([]);
  });

  it("returns stream position conflicts without partially inserting a batch", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);
    const store = createTestStore(db);

    const started = unwrap(
      await appendTestBatch(store, {
        commandInvocationId: "cmd-start",
        commandPayload: {
          name: "query",
          type: "start",
        },
        events: [
          {
            name: "query",
            type: "started",
          },
        ],
        expectedStreamPosition: 0,
      })
    );
    const staleEntries: WorkflowJournalEntry<
      TestCommand,
      TestEvent,
      TestEffect
    >[] = [
      buildManualCommandEntry({
        commandInvocationId: "cmd-stale",
        commitId: "commit-stale",
        entryId: "entry-stale-command",
        streamPosition: 1,
      }),
      buildManualEventEntry({
        commitId: "commit-stale",
        entryId: "entry-stale-event",
        eventId: "event-stale",
        streamPosition: 2,
      }),
    ];

    const conflict = await store.appendEntries({
      entries: staleEntries,
      expectedStreamPosition: 0,
    });
    const duplicateCommand = await store.loadEntriesByCommandInvocation({
      commandInvocationId: "cmd-stale",
      family: "query_action",
    });
    const stream = await store.loadStream({
      family: "query_action",
      streamId: "action_1",
    });

    expect(conflict).toEqual({
      currentStreamPosition: started.cursor.streamPosition,
      kind: "position_conflict",
    });
    expect(duplicateCommand).toBeNull();
    expect(stream.map((entry) => entry.entryId)).toEqual(
      started.entries.map((entry) => entry.entryId)
    );
  });
});
