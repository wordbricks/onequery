import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  asc,
  createDb,
  eq,
  organization,
  prepareApplicationDatabase,
  queryActions,
  workflowEffectDispatches,
  workflowJournal,
} from "@onequery/db/server";
import { afterEach, describe, expect, it } from "vitest";

import type {
  QueryActionCommand,
  QueryActionSourceDescriptor,
} from "./query-action-family";
import {
  decodeQueryActionCommandPayload,
  decodeQueryActionEffectPayload,
  decodeQueryActionEventPayload,
} from "./query-action-family/protobuf-codec";
import type { SourceApiActionCommand } from "./source-api-action-family";
import {
  decodeSourceApiActionCommandPayload,
  decodeSourceApiActionEffectPayload,
  decodeSourceApiActionEventPayload,
} from "./source-api-action-family/protobuf-codec";
import {
  storeQueryActionCommand,
  storeSourceApiActionCommand,
} from "./storage";
import type { StoredWorkflowDecision } from "./storage";

type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

type AnyStoredWorkflowDecision = StoredWorkflowDecision<
  "query_action" | "source_api_action",
  { type: string },
  string
>;

const migrationsFolder = fileURLToPath(
  new URL("../../../db/src/migrations", import.meta.url)
);

const actorSnapshot = {
  authMode: "browser_session",
  email: "jane@example.com",
  membershipRoles: ["owner"],
  userId: "user_1",
} as const;

const sourceDescriptor: QueryActionSourceDescriptor = {
  displayName: "Warehouse",
  name: "warehouse",
  organizationId: "org_1",
  provider: "postgres",
  sourceId: "source_1",
  sourceKey: "warehouse",
  sourceStatus: "active",
};

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

function buildStartValidateCommand(): QueryActionCommand {
  return {
    actionId: null,
    actorSnapshot,
    causedByEventId: null,
    commandInvocationId: "cmd-query-start",
    commandPayload: {
      queryText: "select 1",
      sourceKey: "warehouse",
      type: "start_validate",
    },
    family: "query_action",
    observedAt: new Date("2026-04-20T07:12:00.000Z"),
    organizationId: "org_1",
    requestId: "req-query-1",
    surface: "cli",
  };
}

function buildSourceLoadedCommand(input: {
  actionId: string;
  causedByEventId: string;
}): QueryActionCommand {
  return {
    actionId: input.actionId,
    actorSnapshot,
    causedByEventId: input.causedByEventId,
    commandInvocationId: "cmd-query-source-loaded",
    commandPayload: {
      kind: "found",
      source: sourceDescriptor,
      type: "record_source_lookup",
    },
    family: "query_action",
    observedAt: new Date("2026-04-20T07:12:01.000Z"),
    organizationId: "org_1",
    requestId: "req-query-1",
    surface: "system",
  };
}

function buildValidatePreparationCommand(input: {
  actionId: string;
  causedByEventId: string;
}): QueryActionCommand {
  return {
    actionId: input.actionId,
    actorSnapshot,
    causedByEventId: input.causedByEventId,
    commandInvocationId: "cmd-query-validate-prepared",
    commandPayload: {
      kind: "accepted",
      source: sourceDescriptor,
      truncated: false,
      type: "record_validate_preparation",
      validatedQuery: "SELECT 1",
    },
    family: "query_action",
    observedAt: new Date("2026-04-20T07:12:01.000Z"),
    organizationId: "org_1",
    requestId: "req-query-1",
    surface: "system",
  };
}

function buildMissingQueryActionCommand(): QueryActionCommand {
  return {
    actionId: "missing-query-action",
    actorSnapshot,
    causedByEventId: null,
    commandInvocationId: "cmd-query-missing",
    commandPayload: {
      kind: "found",
      source: sourceDescriptor,
      type: "record_source_lookup",
    },
    family: "query_action",
    observedAt: new Date("2026-04-20T07:14:00.000Z"),
    organizationId: "org_1",
    requestId: "req-query-missing",
    surface: "system",
  };
}

function buildDescribeCommand(): SourceApiActionCommand {
  return {
    actionId: null,
    actorSnapshot,
    causedByEventId: null,
    commandInvocationId: "cmd-source-api-start",
    commandPayload: {
      sourceKey: "warehouse",
      type: "start_describe",
    },
    family: "source_api_action",
    observedAt: new Date("2026-04-20T07:13:00.000Z"),
    organizationId: "org_1",
    requestId: "req-source-api-1",
    surface: "web",
  };
}

async function selectWorkflowCommandRows(
  db: ReturnType<typeof createDb>,
  family: "query_action" | "source_api_action"
) {
  return db
    .select()
    .from(workflowJournal)
    .where(eq(workflowJournal.family, family))
    .orderBy(asc(workflowJournal.streamPosition), asc(workflowJournal.id));
}

async function selectJournalCommandRows(
  db: ReturnType<typeof createDb>,
  family: "query_action" | "source_api_action"
) {
  const rows = await selectWorkflowCommandRows(db, family);
  return rows.filter((row) => row.entryKind === "command");
}

async function selectJournalEventRows(
  db: ReturnType<typeof createDb>,
  family: "query_action" | "source_api_action",
  actionId: string
) {
  const rows = await selectWorkflowCommandRows(db, family);
  return rows.filter(
    (row) => row.entryKind === "event" && row.streamId === actionId
  );
}

function expectStoredDecision<
  Decision extends AnyStoredWorkflowDecision,
  Kind extends Decision["kind"],
>(decision: Decision, kind: Kind): Extract<Decision, { kind: Kind }> {
  expect(decision.kind).toBe(kind);
  if (decision.kind !== kind) {
    throw new Error(`expected ${kind} workflow decision`);
  }

  return decision as Extract<Decision, { kind: Kind }>;
}

function expectFirstCommittedEvent<
  Decision extends Extract<AnyStoredWorkflowDecision, { kind: "accepted" }>,
>(decision: Decision): Decision["events"][number] {
  const event = decision.events[0];
  expect(event).toBeDefined();
  if (!event) {
    throw new Error("expected at least one committed event");
  }

  return event;
}

function expectStoredBinaryPayload(bytes: Buffer): Buffer {
  expect(Buffer.isBuffer(bytes)).toBe(true);
  expect(bytes.length).toBeGreaterThan(0);

  return bytes;
}

function expectPayloadBytes(row: typeof workflowJournal.$inferSelect): Buffer {
  expect(row.payloadBytes).toBeInstanceOf(Buffer);
  if (row.payloadBytes === null) {
    throw new Error("expected journal payload bytes");
  }

  return row.payloadBytes;
}

function expectPayloadType(row: typeof workflowJournal.$inferSelect): string {
  expect(row.payloadType).toBeTypeOf("string");
  if (row.payloadType === null) {
    throw new Error("expected journal payload type");
  }

  return row.payloadType;
}

function unwrapQueryResult(
  result: Awaited<ReturnType<typeof storeQueryActionCommand>>
) {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

function unwrapSourceApiResult(
  result: Awaited<ReturnType<typeof storeSourceApiActionCommand>>
) {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

function omitFreshEffects<
  Decision extends Extract<AnyStoredWorkflowDecision, { kind: "accepted" }> & {
    freshEffects?: unknown;
  },
>(decision: Decision) {
  const { freshEffects: _freshEffects, ...rest } = decision;
  return rest;
}

function decodeStoredQueryActionCommand(
  row: typeof workflowJournal.$inferSelect
) {
  const decoded = decodeQueryActionCommandPayload(
    expectStoredBinaryPayload(expectPayloadBytes(row)),
    {
      actionId: row.streamId,
      commandId: row.id,
      payloadType: expectPayloadType(row),
    }
  );
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

function decodeStoredQueryActionEvent(
  row: typeof workflowJournal.$inferSelect
) {
  const decoded = decodeQueryActionEventPayload(
    expectStoredBinaryPayload(expectPayloadBytes(row)),
    {
      actionId: row.streamId,
      commandId: row.id,
      payloadType: expectPayloadType(row),
    }
  );
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

function decodeStoredQueryActionEffect(
  row: typeof workflowEffectDispatches.$inferSelect
) {
  const decoded = decodeQueryActionEffectPayload(
    expectStoredBinaryPayload(row.payloadBytes),
    {
      actionId: row.actionId,
      payloadType: row.effectType,
    }
  );
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

function decodeStoredSourceApiActionCommand(
  row: typeof workflowJournal.$inferSelect
) {
  const decoded = decodeSourceApiActionCommandPayload(
    expectStoredBinaryPayload(expectPayloadBytes(row)),
    {
      actionId: row.streamId,
      commandId: row.id,
      payloadType: expectPayloadType(row),
    }
  );
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

function decodeStoredSourceApiActionEvent(
  row: typeof workflowJournal.$inferSelect
) {
  const decoded = decodeSourceApiActionEventPayload(
    expectStoredBinaryPayload(expectPayloadBytes(row)),
    {
      actionId: row.streamId,
      commandId: row.id,
      payloadType: expectPayloadType(row),
    }
  );
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

function decodeStoredSourceApiActionEffect(
  row: typeof workflowEffectDispatches.$inferSelect
) {
  const decoded = decodeSourceApiActionEffectPayload(
    expectStoredBinaryPayload(row.payloadBytes),
    {
      actionId: row.actionId,
      payloadType: row.effectType,
    }
  );
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

describe("audit workflow storage", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("commits query commands atomically across the journal, action fold, events, and outbox", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const startResult = await storeQueryActionCommand({
      command: buildStartValidateCommand(),
      db,
    });
    const startDecision = expectStoredDecision(
      unwrapQueryResult(startResult),
      "accepted"
    );

    expect(startDecision).toMatchObject({
      family: "query_action",
      idempotency: "fresh",
      kind: "accepted",
    });

    const startEvent = expectFirstCommittedEvent(startDecision);
    const preparationResult = await storeQueryActionCommand({
      command: buildValidatePreparationCommand({
        actionId: startDecision.actionId,
        causedByEventId: startEvent.id,
      }),
      db,
    });
    const preparationDecision = expectStoredDecision(
      unwrapQueryResult(preparationResult),
      "accepted"
    );

    const queryValidatedEvent = preparationDecision.events.at(-1);
    expect(queryValidatedEvent).toBeDefined();
    if (!queryValidatedEvent) {
      throw new Error("expected a query_validated event");
    }

    const commandRows = await selectJournalCommandRows(db, "query_action");
    const actionRow = await db.query.queryActions.findFirst({
      where: eq(queryActions.id, startDecision.actionId),
    });
    const eventRows = await selectJournalEventRows(
      db,
      "query_action",
      startDecision.actionId
    );
    const outboxRows = await db
      .select()
      .from(workflowEffectDispatches)
      .where(eq(workflowEffectDispatches.actionId, startDecision.actionId))
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(commandRows).toHaveLength(2);
    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_validate",
      "record_validate_preparation_accepted",
    ]);

    expect(actionRow).toMatchObject({
      failureCode: null,
      lastEventId: queryValidatedEvent.id,
      lastEventSequence: 3,
      outcome: "succeeded",
      phase: "completed",
      queryMode: "validate",
      queryText: "select 1",
      usageRecordingStatus: "not_started",
      validatedQuery: "SELECT 1",
    });

    expect(
      eventRows.map((row, index) => ({
        eventType: row.payloadType,
        payload: decodeStoredQueryActionEvent(row),
        sequence: index + 1,
      }))
    ).toEqual([
      {
        eventType: "action_received",
        payload: {
          queryMode: "validate",
          queryText: "select 1",
          type: "action_received",
        },
        sequence: 1,
      },
      {
        eventType: "source_loaded",
        payload: {
          source: sourceDescriptor,
          type: "source_loaded",
        },
        sequence: 2,
      },
      {
        eventType: "query_validated",
        payload: {
          type: "query_validated",
          validatedQuery: "SELECT 1",
        },
        sequence: 3,
      },
    ]);

    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        originEventId: row.originEventId,
        payload: decodeStoredQueryActionEffect(row),
        status: row.status,
      }))
    ).toEqual([
      {
        effectType: "prepare_validate_query",
        originEventId: startEvent.id,
        payload: {
          organizationId: "org_1",
          queryText: "select 1",
          sourceKey: "warehouse",
          type: "prepare_validate_query",
        },
        status: "pending",
      },
    ]);
  });

  it("persists workflow payloads in binary protobuf columns", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const queryDecision = expectStoredDecision(
      unwrapQueryResult(
        await storeQueryActionCommand({
          command: buildStartValidateCommand(),
          db,
        })
      ),
      "accepted"
    );
    const sourceApiDecision = expectStoredDecision(
      unwrapSourceApiResult(
        await storeSourceApiActionCommand({
          command: buildDescribeCommand(),
          db,
        })
      ),
      "accepted"
    );

    const [queryCommandRow] = await selectJournalCommandRows(
      db,
      "query_action"
    );
    const [sourceApiCommandRow] = await selectJournalCommandRows(
      db,
      "source_api_action"
    );
    expect(queryCommandRow).toBeDefined();
    expect(sourceApiCommandRow).toBeDefined();
    if (!queryCommandRow || !sourceApiCommandRow) {
      throw new Error("expected stored command rows");
    }

    expect(decodeStoredQueryActionCommand(queryCommandRow)).toEqual({
      queryText: "select 1",
      sourceKey: "warehouse",
      type: "start_validate",
    });
    expect(decodeStoredSourceApiActionCommand(sourceApiCommandRow)).toEqual({
      sourceKey: "warehouse",
      type: "start_describe",
    });

    const queryEventRows = await selectJournalEventRows(
      db,
      "query_action",
      queryDecision.actionId
    );
    const sourceApiEventRows = await selectJournalEventRows(
      db,
      "source_api_action",
      sourceApiDecision.actionId
    );

    expect(
      queryEventRows.map((row) => ({
        eventType: row.payloadType,
        payload: decodeStoredQueryActionEvent(row),
      }))
    ).toEqual([
      {
        eventType: "action_received",
        payload: {
          queryMode: "validate",
          queryText: "select 1",
          type: "action_received",
        },
      },
    ]);
    expect(
      sourceApiEventRows.map((row) => ({
        eventType: row.payloadType,
        payload: decodeStoredSourceApiActionEvent(row),
      }))
    ).toEqual([
      {
        eventType: "action_received",
        payload: {
          invokeMode: null,
          requestDescriptor: null,
          requestKind: "describe",
          type: "action_received",
        },
      },
    ]);

    const queryEffectRows = await db
      .select()
      .from(workflowEffectDispatches)
      .where(eq(workflowEffectDispatches.family, "query_action"));
    const sourceApiEffectRows = await db
      .select()
      .from(workflowEffectDispatches)
      .where(eq(workflowEffectDispatches.family, "source_api_action"));

    expect(
      queryEffectRows.map((row) => ({
        effectType: row.effectType,
        payload: decodeStoredQueryActionEffect(row),
      }))
    ).toEqual([
      {
        effectType: "prepare_validate_query",
        payload: {
          organizationId: "org_1",
          queryText: "select 1",
          sourceKey: "warehouse",
          type: "prepare_validate_query",
        },
      },
    ]);
    expect(
      sourceApiEffectRows.map((row) => ({
        effectType: row.effectType,
        payload: decodeStoredSourceApiActionEffect(row),
      }))
    ).toEqual([
      {
        effectType: "load_source",
        payload: {
          organizationId: "org_1",
          sourceKey: "warehouse",
          type: "load_source",
        },
      },
    ]);
  });

  it("returns the stored outcome for duplicate command delivery without re-appending rows", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const command = buildStartValidateCommand();
    const firstResult = await storeQueryActionCommand({ command, db });
    const secondResult = await storeQueryActionCommand({ command, db });
    const firstDecision = expectStoredDecision(
      unwrapQueryResult(firstResult),
      "accepted"
    );
    const secondDecision = expectStoredDecision(
      unwrapQueryResult(secondResult),
      "accepted"
    );

    expect(firstDecision).toMatchObject({
      idempotency: "fresh",
      kind: "accepted",
    });
    expect(omitFreshEffects(secondDecision)).toEqual({
      ...omitFreshEffects(firstDecision),
      idempotency: "replayed",
    });

    const commandRows = await selectJournalCommandRows(db, "query_action");
    const eventRows = await selectJournalEventRows(
      db,
      "query_action",
      firstDecision.actionId
    );
    const outboxRows = await db.select().from(workflowEffectDispatches);

    expect(commandRows).toHaveLength(1);
    expect(eventRows).toHaveLength(1);
    expect(outboxRows).toHaveLength(1);
  });

  it("rebuilds a missing action fold from committed events before deciding the next command", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const startDecision = expectStoredDecision(
      unwrapQueryResult(
        await storeQueryActionCommand({
          command: buildStartValidateCommand(),
          db,
        })
      ),
      "accepted"
    );
    const startEvent = expectFirstCommittedEvent(startDecision);

    await db
      .delete(queryActions)
      .where(eq(queryActions.id, startDecision.actionId));

    const sourceLoadedDecision = expectStoredDecision(
      unwrapQueryResult(
        await storeQueryActionCommand({
          command: buildSourceLoadedCommand({
            actionId: startDecision.actionId,
            causedByEventId: startEvent.id,
          }),
          db,
        })
      ),
      "accepted"
    );

    const repairedActionRow = await db.query.queryActions.findFirst({
      where: eq(queryActions.id, startDecision.actionId),
    });

    expect(sourceLoadedDecision.idempotency).toBe("fresh");
    expect(repairedActionRow).toMatchObject({
      lastEventId: expectFirstCommittedEvent(sourceLoadedDecision).id,
      lastEventSequence: 2,
      outcome: "pending",
      phase: "validate_query",
      queryMode: "validate",
      queryText: "select 1",
    });
  });

  it("repairs a corrupt action fold from committed events before deciding the next command", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const startDecision = expectStoredDecision(
      unwrapQueryResult(
        await storeQueryActionCommand({
          command: buildStartValidateCommand(),
          db,
        })
      ),
      "accepted"
    );
    const startEvent = expectFirstCommittedEvent(startDecision);

    await db
      .update(queryActions)
      .set({
        phase: "corrupt_phase",
        queryMode: "corrupt_mode",
      })
      .where(eq(queryActions.id, startDecision.actionId));

    const sourceLoadedDecision = expectStoredDecision(
      unwrapQueryResult(
        await storeQueryActionCommand({
          command: buildSourceLoadedCommand({
            actionId: startDecision.actionId,
            causedByEventId: startEvent.id,
          }),
          db,
        })
      ),
      "accepted"
    );

    const repairedActionRow = await db.query.queryActions.findFirst({
      where: eq(queryActions.id, startDecision.actionId),
    });

    expect(sourceLoadedDecision.idempotency).toBe("fresh");
    expect(repairedActionRow).toMatchObject({
      lastEventId: expectFirstCommittedEvent(sourceLoadedDecision).id,
      lastEventSequence: 2,
      phase: "validate_query",
      queryMode: "validate",
    });
  });

  it("repairs a drifted fold cache last-event pointer from committed events", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const startDecision = expectStoredDecision(
      unwrapQueryResult(
        await storeQueryActionCommand({
          command: buildStartValidateCommand(),
          db,
        })
      ),
      "accepted"
    );
    const startEvent = expectFirstCommittedEvent(startDecision);

    await db
      .update(queryActions)
      .set({
        lastEventId: "missing-event",
        lastEventSequence: 99,
      })
      .where(eq(queryActions.id, startDecision.actionId));

    const sourceLoadedDecision = expectStoredDecision(
      unwrapQueryResult(
        await storeQueryActionCommand({
          command: buildSourceLoadedCommand({
            actionId: startDecision.actionId,
            causedByEventId: startEvent.id,
          }),
          db,
        })
      ),
      "accepted"
    );

    const repairedActionRow = await db.query.queryActions.findFirst({
      where: eq(queryActions.id, startDecision.actionId),
    });

    expect(repairedActionRow).toMatchObject({
      lastEventId: expectFirstCommittedEvent(sourceLoadedDecision).id,
      lastEventSequence: 2,
      phase: "validate_query",
    });
  });

  it("records rejected commands without fabricating events or outbox rows", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const command = buildMissingQueryActionCommand();
    const result = await storeQueryActionCommand({ command, db });
    const rejectedDecision = expectStoredDecision(
      unwrapQueryResult(result),
      "rejected"
    );

    expect(rejectedDecision).toMatchObject({
      actionId: "missing-query-action",
      family: "query_action",
      idempotency: "fresh",
      kind: "rejected",
      rejectCode: "unknown_action",
    });

    const commandRows = await selectJournalCommandRows(db, "query_action");
    const actionRows = await db.select().from(queryActions);
    const eventRows = await selectJournalEventRows(
      db,
      "query_action",
      "missing-query-action"
    );
    const outboxRows = await db.select().from(workflowEffectDispatches);

    expect(commandRows).toHaveLength(1);
    expect(commandRows[0]?.payloadType).toBe("record_source_found");
    expect(actionRows).toHaveLength(0);
    expect(eventRows).toHaveLength(0);
    expect(outboxRows).toHaveLength(0);
  });

  it("returns the stored rejected outcome for duplicate rejected delivery", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const command = buildMissingQueryActionCommand();
    const firstDecision = expectStoredDecision(
      unwrapQueryResult(await storeQueryActionCommand({ command, db })),
      "rejected"
    );
    const secondDecision = expectStoredDecision(
      unwrapQueryResult(await storeQueryActionCommand({ command, db })),
      "rejected"
    );

    expect(firstDecision).toMatchObject({
      idempotency: "fresh",
      rejectCode: "unknown_action",
    });
    expect(secondDecision).toEqual({
      ...firstDecision,
      idempotency: "replayed",
    });

    const commandRows = await selectJournalCommandRows(db, "query_action");
    expect(commandRows).toHaveLength(1);
  });

  it("replays accepted query commands from the journal when old projections are absent", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const command = buildStartValidateCommand();
    const storedDecision = expectStoredDecision(
      unwrapQueryResult(await storeQueryActionCommand({ command, db })),
      "accepted"
    );

    await db
      .delete(queryActions)
      .where(eq(queryActions.id, storedDecision.actionId));
    await db.delete(workflowEffectDispatches);

    const replayedDecision = expectStoredDecision(
      unwrapQueryResult(
        await storeQueryActionCommand({
          command,
          db,
        })
      ),
      "accepted"
    );

    expect(omitFreshEffects(replayedDecision)).toEqual({
      ...omitFreshEffects(storedDecision),
      idempotency: "replayed",
    });
  });

  it("uses a single append-only journal position sequence across families", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const queryResult = await storeQueryActionCommand({
      command: buildStartValidateCommand(),
      db,
    });
    const sourceApiResult = await storeSourceApiActionCommand({
      command: buildDescribeCommand(),
      db,
    });
    expectStoredDecision(unwrapQueryResult(queryResult), "accepted");
    expectStoredDecision(unwrapSourceApiResult(sourceApiResult), "accepted");

    const journalRows = await db
      .select()
      .from(workflowJournal)
      .orderBy(asc(workflowJournal.commitPosition));

    expect(journalRows.map((row) => row.commitPosition)).toEqual([
      1n,
      2n,
      3n,
      4n,
      5n,
      6n,
    ]);
  });
});
