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
  queryActionEvents,
  queryActions,
  sourceApiActionEvents,
  workflowCommands,
  workflowEffectDispatches,
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
    .from(workflowCommands)
    .where(eq(workflowCommands.family, family))
    .orderBy(asc(workflowCommands.createdAt), asc(workflowCommands.id));
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

function unwrapQueryError(
  result: Awaited<ReturnType<typeof storeQueryActionCommand>>
) {
  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error("expected query workflow storage error");
  }

  return result.error;
}

function decodeStoredQueryActionCommand(
  row: typeof workflowCommands.$inferSelect
) {
  const decoded = decodeQueryActionCommandPayload(
    expectStoredBinaryPayload(row.commandPayloadBytes),
    {
      ...(row.actionId === null ? {} : { actionId: row.actionId }),
      commandId: row.id,
      payloadType: row.commandType,
    }
  );
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

function decodeStoredQueryActionEvent(
  row: typeof queryActionEvents.$inferSelect
) {
  const decoded = decodeQueryActionEventPayload(
    expectStoredBinaryPayload(row.payloadBytes),
    {
      actionId: row.actionId,
      commandId: row.commandId,
      payloadType: row.eventType,
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
  row: typeof workflowCommands.$inferSelect
) {
  const decoded = decodeSourceApiActionCommandPayload(
    expectStoredBinaryPayload(row.commandPayloadBytes),
    {
      ...(row.actionId === null ? {} : { actionId: row.actionId }),
      commandId: row.id,
      payloadType: row.commandType,
    }
  );
  expect(decoded.isOk()).toBe(true);
  if (decoded.isErr()) {
    throw decoded.error;
  }

  return decoded.value;
}

function decodeStoredSourceApiActionEvent(
  row: typeof sourceApiActionEvents.$inferSelect
) {
  const decoded = decodeSourceApiActionEventPayload(
    expectStoredBinaryPayload(row.payloadBytes),
    {
      actionId: row.actionId,
      commandId: row.commandId,
      payloadType: row.eventType,
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
    const sourceLoadedResult = await storeQueryActionCommand({
      command: buildSourceLoadedCommand({
        actionId: startDecision.actionId,
        causedByEventId: startEvent.id,
      }),
      db,
    });
    const sourceLoadedDecision = expectStoredDecision(
      unwrapQueryResult(sourceLoadedResult),
      "accepted"
    );

    const sourceLoadedEvent = expectFirstCommittedEvent(sourceLoadedDecision);

    const commandRows = await selectWorkflowCommandRows(db, "query_action");
    const actionRow = await db.query.queryActions.findFirst({
      where: eq(queryActions.id, startDecision.actionId),
    });
    const eventRows = await db
      .select()
      .from(queryActionEvents)
      .where(eq(queryActionEvents.actionId, startDecision.actionId))
      .orderBy(asc(queryActionEvents.sequence));
    const outboxRows = await db
      .select()
      .from(workflowEffectDispatches)
      .where(eq(workflowEffectDispatches.actionId, startDecision.actionId))
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(commandRows).toHaveLength(2);
    expect(commandRows.map((row) => row.decisionKind)).toEqual([
      "accepted",
      "accepted",
    ]);

    expect(actionRow).toMatchObject({
      failureCode: null,
      lastEventId: sourceLoadedEvent.id,
      lastEventSequence: 2,
      outcome: "pending",
      phase: "validate_query",
      queryMode: "validate",
      queryText: "select 1",
      usageRecordingStatus: "not_started",
      validatedQuery: null,
    });

    expect(
      eventRows.map((row) => ({
        commandId: row.commandId,
        commitPosition: row.commitPosition,
        eventType: row.eventType,
        payload: decodeStoredQueryActionEvent(row),
        sequence: row.sequence,
      }))
    ).toEqual([
      {
        commandId: startDecision.commandId,
        commitPosition: 1n,
        eventType: "action_received",
        payload: {
          queryMode: "validate",
          queryText: "select 1",
          type: "action_received",
        },
        sequence: 1,
      },
      {
        commandId: sourceLoadedDecision.commandId,
        commitPosition: 2n,
        eventType: "source_loaded",
        payload: {
          source: sourceDescriptor,
          type: "source_loaded",
        },
        sequence: 2,
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
        effectType: "load_source",
        originEventId: startEvent.id,
        payload: {
          organizationId: "org_1",
          sourceKey: "warehouse",
          type: "load_source",
        },
        status: "pending",
      },
      {
        effectType: "validate_query",
        originEventId: sourceLoadedEvent.id,
        payload: {
          queryText: "select 1",
          source: sourceDescriptor,
          type: "validate_query",
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

    const [queryCommandRow] = await selectWorkflowCommandRows(
      db,
      "query_action"
    );
    const [sourceApiCommandRow] = await selectWorkflowCommandRows(
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

    const queryEventRows = await db
      .select()
      .from(queryActionEvents)
      .where(eq(queryActionEvents.commandId, queryDecision.commandId));
    const sourceApiEventRows = await db
      .select()
      .from(sourceApiActionEvents)
      .where(eq(sourceApiActionEvents.commandId, sourceApiDecision.commandId));

    expect(
      queryEventRows.map((row) => ({
        eventType: row.eventType,
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
        eventType: row.eventType,
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
        effectType: "load_source",
        payload: {
          organizationId: "org_1",
          sourceKey: "warehouse",
          type: "load_source",
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
    expect(secondDecision).toEqual({
      ...firstDecision,
      idempotency: "replayed",
    });

    const commandRows = await selectWorkflowCommandRows(db, "query_action");
    const eventRows = await db.select().from(queryActionEvents);
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

  it("keeps event history when an action fold row is deleted so the cache can rebuild", async () => {
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

    await db
      .delete(queryActions)
      .where(eq(queryActions.id, startDecision.actionId));

    const orphanedEventRows = await db
      .select()
      .from(queryActionEvents)
      .where(eq(queryActionEvents.actionId, startDecision.actionId));

    expect(orphanedEventRows).toHaveLength(1);
    expect(orphanedEventRows[0]?.eventType).toBe("action_received");
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

    const commandRows = await selectWorkflowCommandRows(db, "query_action");
    const actionRows = await db.select().from(queryActions);
    const eventRows = await db.select().from(queryActionEvents);
    const outboxRows = await db.select().from(workflowEffectDispatches);

    expect(commandRows).toHaveLength(1);
    expect(commandRows[0]?.decisionKind).toBe("rejected");
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

    const commandRows = await selectWorkflowCommandRows(db, "query_action");
    expect(commandRows).toHaveLength(1);
  });

  it("surfaces corrupt row errors when a stored accepted event payload is corrupt", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const command = buildStartValidateCommand();
    const storedDecision = expectStoredDecision(
      unwrapQueryResult(await storeQueryActionCommand({ command, db })),
      "accepted"
    );

    await db
      .update(queryActionEvents)
      .set({
        payloadBytes: Buffer.from([0xff]),
      })
      .where(eq(queryActionEvents.commandId, storedDecision.commandId));

    const error = unwrapQueryError(
      await storeQueryActionCommand({
        command,
        db,
      })
    );

    expect(error._tag).toBe("WorkflowStorageCorruptRowError");
    if (error._tag !== "WorkflowStorageCorruptRowError") {
      throw error;
    }
    expect(error.entity).toBe("query_action_event_payload");
    expect(error.family).toBe("query_action");
  });

  it("uses an independent commit position sequence per family", async () => {
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
    const queryDecision = expectStoredDecision(
      unwrapQueryResult(queryResult),
      "accepted"
    );
    const sourceApiDecision = expectStoredDecision(
      unwrapSourceApiResult(sourceApiResult),
      "accepted"
    );

    const queryEventRow = await db.query.queryActionEvents.findFirst({
      where: eq(queryActionEvents.commandId, queryDecision.commandId),
    });
    const sourceApiEventRow = await db.query.sourceApiActionEvents.findFirst({
      where: eq(sourceApiActionEvents.commandId, sourceApiDecision.commandId),
    });

    expect(queryEventRow?.commitPosition).toBe(1n);
    expect(sourceApiEventRow?.commitPosition).toBe(1n);
  });
});
