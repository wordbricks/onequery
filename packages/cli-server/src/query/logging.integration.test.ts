import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDb,
  eq,
  getDatabaseSchema,
  prepareSelfHostDatabase,
} from "@onequery/db/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendCliQueryActionTrailEvent,
  createCliQueryActionTrail,
} from "./logging";

type CliQueryActionTrailActor = import("./logging").CliQueryActionTrailActor;

type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
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
  new URL("../../../db/src/migrations", import.meta.url)
);

async function createTestDb() {
  const connectionString = `pglite:${join(tmpdir(), "pglite", randomUUID())}`;
  await prepareSelfHostDatabase({
    connectionString,
    migrationsFolder,
  });
  return createDb(connectionString);
}

async function seedQueryFixtures(db: ReturnType<typeof createDb>) {
  const schema = getDatabaseSchema(db);
  const { cliQueryActionEvents, cliQueryActions, dataSources, organization } =
    schema;

  await db.insert(organization).values({
    id: "org_1",
    name: "Org One",
    slug: "org-one",
  });
  await db.insert(dataSources).values({
    credentialsEncrypted: "cipher",
    credentialsIv: "iv",
    id: "source_1",
    name: "warehouse",
    organizationId: "org_1",
    provider: "postgres",
    status: "active",
  });

  return {
    cliQueryActionEvents,
    cliQueryActions,
  };
}

function buildPostgresSource() {
  return {
    credentialsEncrypted: "cipher",
    credentialsIv: "iv",
    displayName: null,
    id: "source_1",
    name: "warehouse",
    organizationId: "org_1",
    provider: "postgres" as const,
    sourceKey: "warehouse",
    status: "active" as const,
  };
}

function buildTrailActor(): CliQueryActionTrailActor {
  return {
    authMode: "browser_session",
    email: "jane@example.com",
    membershipRoles: ["owner"],
    userId: "user_1",
  };
}

describe("cli query action trail", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("folds the latest query action state while appending immutable events", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActionEvents, cliQueryActions } =
      await seedQueryFixtures(db);
    const source = buildPostgresSource();
    const actor = buildTrailActor();

    const { actionId, eventId: receivedEventId } =
      await createCliQueryActionTrail({
        actionType: "execute",
        actor,
        cellMaxChars: 120,
        db,
        maxBytes: 4096,
        maxRows: 100,
        organizationId: "org_1",
        requestId: "req-1",
        sourceKey: "warehouse",
        sql: "select answer from stats",
        timeoutMs: 15_000,
      });

    const { eventId: sourceLoadedEventId } =
      await appendCliQueryActionTrailEvent({
        actionId,
        db,
        event: {
          actionType: "execute",
          requestId: "req-1",
          source,
          sourceKey: "warehouse",
          type: "source_loaded",
        },
      });
    const { eventId: validatedEventId } = await appendCliQueryActionTrailEvent({
      actionId,
      db,
      event: {
        actionType: "execute",
        normalizedSql: "SELECT answer FROM stats LIMIT 1000",
        normalizedSqlChanged: true,
        requestId: "req-1",
        source,
        sourceKey: "warehouse",
        type: "query_validated",
      },
    });
    const { eventId: credentialsLoadedEventId } =
      await appendCliQueryActionTrailEvent({
        actionId,
        db,
        event: {
          actionType: "execute",
          requestId: "req-1",
          source,
          sourceKey: "warehouse",
          type: "credentials_loaded",
        },
      });
    const { eventId: executedEventId } = await appendCliQueryActionTrailEvent({
      actionId,
      db,
      event: {
        actionType: "execute",
        elapsedMs: 18,
        requestId: "req-1",
        rowCount: 1,
        source,
        sourceKey: "warehouse",
        type: "query_executed",
      },
    });
    const { eventId: usagePersistFailedEventId } =
      await appendCliQueryActionTrailEvent({
        actionId,
        db,
        event: {
          actionType: "execute",
          detail: "write unavailable",
          requestId: "req-1",
          sourceId: "source_1",
          sourceKey: "warehouse",
          type: "usage_persist_failed",
        },
      });

    const action = await db.query.cliQueryActions.findFirst({
      where: eq(cliQueryActions.id, actionId),
    });
    const events = await db
      .select()
      .from(cliQueryActionEvents)
      .where(eq(cliQueryActionEvents.queryActionId, actionId));
    const eventsById = new Map(events.map((event) => [event.id, event]));

    expect(action).toMatchObject({
      actionType: "execute",
      actorAuthMode: "browser_session",
      actorEmail: "jane@example.com",
      actorMembershipRoles: ["owner"],
      actorUserId: "user_1",
      elapsedMs: 18,
      errorDetail: "write unavailable",
      id: actionId,
      lastEventId: usagePersistFailedEventId,
      normalizedSql: "SELECT answer FROM stats LIMIT 1000",
      normalizedSqlChanged: true,
      provider: "postgres",
      requestId: "req-1",
      rowCount: 1,
      sourceId: "source_1",
      sourceKey: "warehouse",
      sourceStatus: "active",
      stage: "completed",
      status: "succeeded",
      usagePersistenceStatus: "failed",
      version: 6,
    });
    expect(
      [
        receivedEventId,
        sourceLoadedEventId,
        validatedEventId,
        credentialsLoadedEventId,
        executedEventId,
        usagePersistFailedEventId,
      ].map((id) => eventsById.get(id)?.sql ?? null)
    ).toEqual(["select answer from stats", null, null, null, null, null]);
    expect(
      [
        receivedEventId,
        sourceLoadedEventId,
        validatedEventId,
        credentialsLoadedEventId,
        executedEventId,
        usagePersistFailedEventId,
      ].map((id) =>
        eventsById.get(id)
          ? {
              actorAuthMode: eventsById.get(id)?.actorAuthMode,
              actorEmail: eventsById.get(id)?.actorEmail,
              actorMembershipRoles: eventsById.get(id)?.actorMembershipRoles,
              actorUserId: eventsById.get(id)?.actorUserId,
            }
          : null
      )
    ).toEqual([
      {
        actorAuthMode: "browser_session",
        actorEmail: "jane@example.com",
        actorMembershipRoles: ["owner"],
        actorUserId: "user_1",
      },
      {
        actorAuthMode: "browser_session",
        actorEmail: "jane@example.com",
        actorMembershipRoles: ["owner"],
        actorUserId: "user_1",
      },
      {
        actorAuthMode: "browser_session",
        actorEmail: "jane@example.com",
        actorMembershipRoles: ["owner"],
        actorUserId: "user_1",
      },
      {
        actorAuthMode: "browser_session",
        actorEmail: "jane@example.com",
        actorMembershipRoles: ["owner"],
        actorUserId: "user_1",
      },
      {
        actorAuthMode: "browser_session",
        actorEmail: "jane@example.com",
        actorMembershipRoles: ["owner"],
        actorUserId: "user_1",
      },
      {
        actorAuthMode: "browser_session",
        actorEmail: "jane@example.com",
        actorMembershipRoles: ["owner"],
        actorUserId: "user_1",
      },
    ]);
    expect(
      [
        receivedEventId,
        sourceLoadedEventId,
        validatedEventId,
        credentialsLoadedEventId,
        executedEventId,
        usagePersistFailedEventId,
      ].map((id) => eventsById.get(id)?.eventType)
    ).toEqual([
      "action_received",
      "source_loaded",
      "query_validated",
      "credentials_loaded",
      "query_executed",
      "usage_persist_failed",
    ]);
    expect(
      [
        receivedEventId,
        sourceLoadedEventId,
        validatedEventId,
        credentialsLoadedEventId,
        executedEventId,
        usagePersistFailedEventId,
      ].map((id) => eventsById.get(id)?.causationEventId ?? null)
    ).toEqual([
      null,
      receivedEventId,
      sourceLoadedEventId,
      validatedEventId,
      credentialsLoadedEventId,
      executedEventId,
    ]);
  });

  it("treats duplicate workflow event delivery as idempotent", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActionEvents, cliQueryActions } =
      await seedQueryFixtures(db);
    const source = buildPostgresSource();
    const actor = buildTrailActor();

    const { actionId } = await createCliQueryActionTrail({
      actionType: "execute",
      actor,
      cellMaxChars: 120,
      db,
      maxBytes: 4096,
      maxRows: 100,
      organizationId: "org_1",
      requestId: "req-2",
      sourceKey: "warehouse",
      sql: "select answer from stats",
      timeoutMs: 15_000,
    });

    const first = await appendCliQueryActionTrailEvent({
      actionId,
      db,
      event: {
        actionType: "execute",
        requestId: "req-2",
        source,
        sourceKey: "warehouse",
        type: "source_loaded",
      },
    });
    const second = await appendCliQueryActionTrailEvent({
      actionId,
      db,
      event: {
        actionType: "execute",
        requestId: "req-2",
        source,
        sourceKey: "warehouse",
        type: "source_loaded",
      },
    });

    const action = await db.query.cliQueryActions.findFirst({
      where: eq(cliQueryActions.id, actionId),
    });
    const events = await db
      .select()
      .from(cliQueryActionEvents)
      .where(eq(cliQueryActionEvents.queryActionId, actionId));

    expect(second).toEqual(first);
    expect(events).toHaveLength(2);
    expect(action).toMatchObject({
      id: actionId,
      lastEventId: first.eventId,
      stage: "validate_query",
      status: "pending",
      version: 2,
    });
  });

  it("completes validate actions and persists failure hints", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const { cliQueryActionEvents, cliQueryActions } =
      await seedQueryFixtures(db);
    const source = buildPostgresSource();
    const actor = buildTrailActor();

    const validateLog = await createCliQueryActionTrail({
      actionType: "validate",
      actor,
      cellMaxChars: 120,
      db,
      maxBytes: 4096,
      maxRows: 100,
      organizationId: "org_1",
      requestId: "req-3",
      sourceKey: "warehouse",
      sql: "select answer from stats",
      timeoutMs: 15_000,
    });
    await appendCliQueryActionTrailEvent({
      actionId: validateLog.actionId,
      db,
      event: {
        actionType: "validate",
        requestId: "req-3",
        source,
        sourceKey: "warehouse",
        type: "source_loaded",
      },
    });
    const validated = await appendCliQueryActionTrailEvent({
      actionId: validateLog.actionId,
      db,
      event: {
        actionType: "validate",
        normalizedSql: "SELECT answer FROM stats LIMIT 1000",
        normalizedSqlChanged: true,
        requestId: "req-3",
        source,
        sourceKey: "warehouse",
        type: "query_validated",
      },
    });

    const validateAction = await db.query.cliQueryActions.findFirst({
      where: eq(cliQueryActions.id, validateLog.actionId),
    });
    expect(validateAction).toMatchObject({
      id: validateLog.actionId,
      lastEventId: validated.eventId,
      normalizedSql: "SELECT answer FROM stats LIMIT 1000",
      normalizedSqlChanged: true,
      stage: "completed",
      status: "succeeded",
      version: 3,
    });

    const executeLog = await createCliQueryActionTrail({
      actionType: "execute",
      actor,
      cellMaxChars: 120,
      db,
      maxBytes: 4096,
      maxRows: 100,
      organizationId: "org_1",
      requestId: "req-4",
      sourceKey: "warehouse",
      sql: "select answer from stats",
      timeoutMs: 15_000,
    });
    await appendCliQueryActionTrailEvent({
      actionId: executeLog.actionId,
      db,
      event: {
        actionType: "execute",
        requestId: "req-4",
        source,
        sourceKey: "warehouse",
        type: "source_loaded",
      },
    });
    await appendCliQueryActionTrailEvent({
      actionId: executeLog.actionId,
      db,
      event: {
        actionType: "execute",
        normalizedSql: "SELECT answer FROM stats LIMIT 1000",
        normalizedSqlChanged: true,
        requestId: "req-4",
        source,
        sourceKey: "warehouse",
        type: "query_validated",
      },
    });
    const failed = await appendCliQueryActionTrailEvent({
      actionId: executeLog.actionId,
      db,
      event: {
        actionType: "execute",
        detail: "failed to decrypt credentials",
        hint: "verify the source configuration and retry",
        requestId: "req-4",
        source,
        sourceKey: "warehouse",
        type: "query_preparation_failed",
      },
    });

    const failedAction = await db.query.cliQueryActions.findFirst({
      where: eq(cliQueryActions.id, executeLog.actionId),
    });
    const failedEvent = await db.query.cliQueryActionEvents.findFirst({
      where: eq(cliQueryActionEvents.id, failed.eventId),
    });

    expect(failedAction).toMatchObject({
      errorDetail: "failed to decrypt credentials",
      errorHint: "verify the source configuration and retry",
      id: executeLog.actionId,
      stage: "completed",
      status: "query_preparation_failed",
    });
    expect(failedEvent).toMatchObject({
      errorDetail: "failed to decrypt credentials",
      errorHint: "verify the source configuration and retry",
      id: failed.eventId,
    });
  });

  it("rejects impossible workflow transitions", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    await seedQueryFixtures(db);

    const { actionId } = await createCliQueryActionTrail({
      actionType: "validate",
      actor: buildTrailActor(),
      cellMaxChars: 120,
      db,
      maxBytes: 4096,
      maxRows: 100,
      organizationId: "org_1",
      requestId: "req-5",
      sourceKey: "warehouse",
      sql: "select answer from stats",
      timeoutMs: 15_000,
    });

    await expect(
      appendCliQueryActionTrailEvent({
        actionId,
        db,
        event: {
          actionType: "execute",
          requestId: "req-5",
          source: buildPostgresSource(),
          sourceKey: "warehouse",
          type: "credentials_loaded",
        },
      })
    ).rejects.toThrow("cannot accept credentials_loaded");
  });
});
