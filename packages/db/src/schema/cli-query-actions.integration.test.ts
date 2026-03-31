import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDb,
  eq,
  getDatabaseSchema,
  prepareSelfHostDatabase,
} from "../server";

type ClosableDatabase = {
  $client?: {
    close?: () => void;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
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

const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url)
);

async function createTestDb() {
  const connectionString = `pglite:${join(tmpdir(), "pglite", randomUUID())}`;
  await prepareSelfHostDatabase({
    connectionString,
    migrationsFolder,
  });
  return createDb(connectionString);
}

const ACTOR = {
  actorAuthMode: "browser_session" as const,
  actorEmail: "jane@example.com",
  actorMembershipRoles: ["owner"],
  actorUserId: "user_1",
};

describe("cli query action schema", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("applies action defaults for the pglite runtime", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActions, organization } = getDatabaseSchema(db);

    await db.insert(organization).values({
      id: "org_1",
      name: "Org One",
      slug: "org-one",
    });

    await db.insert(cliQueryActions).values({
      actionType: "validate",
      ...ACTOR,
      organizationId: "org_1",
      requestId: "req-1",
      sourceKey: "warehouse",
      sql: "select 1",
    });

    const action = await db.query.cliQueryActions.findFirst({
      where: eq(cliQueryActions.requestId, "req-1"),
    });

    expect(action).toMatchObject({
      actionType: "validate",
      ...ACTOR,
      actorMembershipRoles: ["owner"],
      requestId: "req-1",
      stage: "received",
      status: "pending",
      usagePersistenceStatus: "not_started",
      version: 1,
    });
  });

  it("rejects invalid event values and impossible causation links", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActionEvents, cliQueryActions, organization } =
      getDatabaseSchema(db);

    await db.insert(organization).values({
      id: "org_1",
      name: "Org One",
      slug: "org-one",
    });
    await db.insert(cliQueryActions).values({
      id: "action_1",
      actionType: "execute",
      ...ACTOR,
      organizationId: "org_1",
      requestId: "req-2",
      sourceKey: "warehouse",
      sql: "select 1",
    });

    await expect(
      db.insert(cliQueryActionEvents).values({
        actionType: "execute",
        ...ACTOR,
        eventType: "invalid" as never,
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-2",
        sourceKey: "warehouse",
        sql: "select 1",
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      })
    ).rejects.toThrow();

    await expect(
      db.insert(cliQueryActionEvents).values({
        actionType: "execute",
        causationEventId: "event-self",
        ...ACTOR,
        eventType: "action_received",
        id: "event-self",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-2",
        sourceKey: "warehouse",
        sql: "select 1",
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      })
    ).rejects.toThrow();
  });

  it("rejects cross-action pointers and mismatched action snapshots", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActionEvents, cliQueryActions, organization } =
      getDatabaseSchema(db);

    await db.insert(organization).values({
      id: "org_1",
      name: "Org One",
      slug: "org-one",
    });
    await db.insert(cliQueryActions).values([
      {
        id: "action_1",
        actionType: "execute",
        ...ACTOR,
        organizationId: "org_1",
        requestId: "req-20",
        sourceKey: "warehouse",
        sql: "select 1",
      },
      {
        id: "action_2",
        actionType: "execute",
        ...ACTOR,
        organizationId: "org_1",
        requestId: "req-21",
        sourceKey: "warehouse",
        sql: "select 2",
      },
    ]);
    await db.insert(cliQueryActionEvents).values([
      {
        actionType: "execute",
        ...ACTOR,
        eventType: "action_received",
        id: "event_1",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-20",
        sourceKey: "warehouse",
        sql: "select 1",
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      },
      {
        actionType: "execute",
        ...ACTOR,
        eventType: "action_received",
        id: "event_2",
        organizationId: "org_1",
        queryActionId: "action_2",
        requestId: "req-21",
        sourceKey: "warehouse",
        sql: "select 2",
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      },
    ]);

    await expect(
      db.insert(cliQueryActionEvents).values({
        actionType: "execute",
        ...ACTOR,
        causationEventId: "event_2",
        eventType: "source_loaded",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-20",
        sourceKey: "warehouse",
        sql: null,
        stage: "validate_query",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      })
    ).rejects.toThrow();

    await expect(
      db.insert(cliQueryActionEvents).values({
        actionType: "execute",
        ...ACTOR,
        causationEventId: "event_1",
        eventType: "source_loaded",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-mismatch",
        sourceKey: "warehouse",
        sql: null,
        stage: "validate_query",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      })
    ).rejects.toThrow();
  });

  it("rejects duplicate event types for the same action", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActionEvents, cliQueryActions, organization } =
      getDatabaseSchema(db);

    await db.insert(organization).values({
      id: "org_1",
      name: "Org One",
      slug: "org-one",
    });
    await db.insert(cliQueryActions).values({
      id: "action_1",
      actionType: "execute",
      ...ACTOR,
      organizationId: "org_1",
      requestId: "req-3",
      sourceKey: "warehouse",
      sql: "select 1",
    });

    await db.insert(cliQueryActionEvents).values([
      {
        actionType: "execute",
        ...ACTOR,
        eventType: "action_received",
        id: "event_0",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-3",
        sourceKey: "warehouse",
        sql: "select 1",
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      },
      {
        actionType: "execute",
        ...ACTOR,
        causationEventId: "event_0",
        eventType: "source_loaded",
        id: "event_1",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-3",
        sourceKey: "warehouse",
        sql: null,
        stage: "validate_query",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      },
    ]);
    const event = await db.query.cliQueryActionEvents.findFirst({
      where: eq(cliQueryActionEvents.id, "event_1"),
    });

    expect(event?.sql).toBeNull();

    await expect(
      db.insert(cliQueryActionEvents).values([
        {
          actionType: "execute",
          ...ACTOR,
          causationEventId: "event_0",
          eventType: "source_loaded",
          id: "event_2",
          organizationId: "org_1",
          queryActionId: "action_1",
          requestId: "req-3",
          sourceKey: "warehouse",
          sql: null,
          stage: "validate_query",
          status: "pending",
          usagePersistenceStatus: "not_started",
          occurredAt: new Date(),
        },
      ])
    ).rejects.toThrow();
  });

  it("rejects folded last-event pointers that do not reference an event", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActionEvents, cliQueryActions, organization } =
      getDatabaseSchema(db);

    await db.insert(organization).values({
      id: "org_1",
      name: "Org One",
      slug: "org-one",
    });
    await db.insert(cliQueryActions).values([
      {
        id: "action_1",
        actionType: "execute",
        ...ACTOR,
        organizationId: "org_1",
        requestId: "req-4",
        sourceKey: "warehouse",
        sql: "select 1",
      },
      {
        id: "action_2",
        actionType: "execute",
        ...ACTOR,
        organizationId: "org_1",
        requestId: "req-5",
        sourceKey: "warehouse",
        sql: "select 2",
      },
    ]);
    await db.insert(cliQueryActionEvents).values([
      {
        actionType: "execute",
        ...ACTOR,
        eventType: "action_received",
        id: "event_1",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-4",
        sourceKey: "warehouse",
        sql: "select 1",
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      },
      {
        actionType: "execute",
        ...ACTOR,
        eventType: "action_received",
        id: "event_2",
        organizationId: "org_1",
        queryActionId: "action_2",
        requestId: "req-5",
        sourceKey: "warehouse",
        sql: "select 2",
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      },
    ]);

    await db
      .update(cliQueryActions)
      .set({
        lastEventId: "event_1",
      })
      .where(eq(cliQueryActions.id, "action_1"));

    await expect(
      db
        .update(cliQueryActions)
        .set({
          lastEventId: "event_2",
        })
        .where(eq(cliQueryActions.id, "action_1"))
    ).rejects.toThrow();

    await expect(
      db
        .update(cliQueryActions)
        .set({
          lastEventId: "missing_event",
        })
        .where(eq(cliQueryActions.id, "action_1"))
    ).rejects.toThrow();
  });

  it("rejects impossible lifecycle payloads and terminal aggregate states", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActionEvents, cliQueryActions, organization } =
      getDatabaseSchema(db);

    await db.insert(organization).values({
      id: "org_1",
      name: "Org One",
      slug: "org-one",
    });
    await db.insert(cliQueryActions).values({
      id: "action_1",
      actionType: "execute",
      ...ACTOR,
      organizationId: "org_1",
      requestId: "req-30",
      sourceKey: "warehouse",
      sql: "select 1",
    });

    await expect(
      db.insert(cliQueryActionEvents).values({
        actionType: "execute",
        ...ACTOR,
        eventType: "action_received",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-30",
        sourceKey: "warehouse",
        sql: null,
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      })
    ).rejects.toThrow();

    await db.insert(cliQueryActionEvents).values({
      actionType: "execute",
      ...ACTOR,
      eventType: "action_received",
      id: "event_1",
      organizationId: "org_1",
      queryActionId: "action_1",
      requestId: "req-30",
      sourceKey: "warehouse",
      sql: "select 1",
      stage: "received",
      status: "pending",
      usagePersistenceStatus: "not_started",
      occurredAt: new Date(),
    });

    await expect(
      db.insert(cliQueryActionEvents).values({
        actionType: "execute",
        ...ACTOR,
        causationEventId: "event_1",
        eventType: "source_loaded",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-30",
        sourceKey: "warehouse",
        sql: "select 1",
        stage: "received",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      })
    ).rejects.toThrow();

    await expect(
      db.insert(cliQueryActionEvents).values({
        actionType: "execute",
        ...ACTOR,
        causationEventId: "event_1",
        eventType: "query_validated",
        organizationId: "org_1",
        queryActionId: "action_1",
        requestId: "req-30",
        sourceKey: "warehouse",
        sql: null,
        stage: "load_credentials",
        status: "pending",
        usagePersistenceStatus: "not_started",
        occurredAt: new Date(),
      })
    ).rejects.toThrow();

    await expect(
      db
        .update(cliQueryActions)
        .set({
          completedAt: null,
          stage: "completed",
          status: "succeeded",
        })
        .where(eq(cliQueryActions.id, "action_1"))
    ).rejects.toThrow();

    await expect(
      db
        .update(cliQueryActions)
        .set({
          completedAt: null,
          stage: "validate_query",
          status: "succeeded",
        })
        .where(eq(cliQueryActions.id, "action_1"))
    ).rejects.toThrow();
  });
});
