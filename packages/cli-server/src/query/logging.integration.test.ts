import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDb,
  eq,
  getDatabaseSchema,
  prepareApplicationDatabase,
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
  await prepareApplicationDatabase({
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
    const orderedEventIds = [
      receivedEventId,
      sourceLoadedEventId,
      validatedEventId,
      credentialsLoadedEventId,
      executedEventId,
      usagePersistFailedEventId,
    ];
    const eventLabelById = new Map([
      [receivedEventId, "receivedEventId"],
      [sourceLoadedEventId, "sourceLoadedEventId"],
      [validatedEventId, "validatedEventId"],
      [credentialsLoadedEventId, "credentialsLoadedEventId"],
      [executedEventId, "executedEventId"],
      [usagePersistFailedEventId, "usagePersistFailedEventId"],
    ]);

    expect({
      action: action
        ? {
            actionType: action.actionType,
            actorAuthMode: action.actorAuthMode,
            actorEmail: action.actorEmail,
            actorMembershipRoles: action.actorMembershipRoles,
            actorUserId: action.actorUserId,
            elapsedMs: action.elapsedMs,
            errorDetail: action.errorDetail,
            id: action.id === actionId ? "<actionId>" : action.id,
            lastEventId: action.lastEventId
              ? `<${eventLabelById.get(action.lastEventId)}>`
              : null,
            normalizedSql: action.normalizedSql,
            normalizedSqlChanged: action.normalizedSqlChanged,
            provider: action.provider,
            requestId: action.requestId,
            rowCount: action.rowCount,
            sourceId: action.sourceId,
            sourceKey: action.sourceKey,
            sourceStatus: action.sourceStatus,
            stage: action.stage,
            status: action.status,
            usagePersistenceStatus: action.usagePersistenceStatus,
            version: action.version,
          }
        : null,
      events: orderedEventIds.map((id) => {
        const event = eventsById.get(id);
        return event
          ? {
              actor: {
                actorAuthMode: event.actorAuthMode,
                actorEmail: event.actorEmail,
                actorMembershipRoles: event.actorMembershipRoles,
                actorUserId: event.actorUserId,
              },
              causationEventId: event.causationEventId
                ? `<${eventLabelById.get(event.causationEventId)}>`
                : null,
              eventType: event.eventType,
              sql: event.sql ?? null,
            }
          : null;
      }),
    }).toMatchSnapshot();
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
    expect({
      action: action
        ? {
            id: action.id === actionId ? "<actionId>" : action.id,
            lastEventId:
              action.lastEventId === first.eventId
                ? "<sourceLoadedEventId>"
                : action.lastEventId,
            stage: action.stage,
            status: action.status,
            version: action.version,
          }
        : null,
      first: {
        eventId: "<sourceLoadedEventId>",
      },
      second: {
        eventId:
          second.eventId === first.eventId
            ? "<sourceLoadedEventId>"
            : second.eventId,
      },
    }).toMatchSnapshot();
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

    expect({
      failedAction: failedAction
        ? {
            errorDetail: failedAction.errorDetail,
            errorHint: failedAction.errorHint,
            id:
              failedAction.id === executeLog.actionId
                ? "<executeActionId>"
                : failedAction.id,
            stage: failedAction.stage,
            status: failedAction.status,
          }
        : null,
      failedEvent: failedEvent
        ? {
            errorDetail: failedEvent.errorDetail,
            errorHint: failedEvent.errorHint,
            id:
              failedEvent.id === failed.eventId
                ? "<failedEventId>"
                : failedEvent.id,
          }
        : null,
      validateAction: validateAction
        ? {
            id:
              validateAction.id === validateLog.actionId
                ? "<validateActionId>"
                : validateAction.id,
            lastEventId:
              validateAction.lastEventId === validated.eventId
                ? "<validatedEventId>"
                : validateAction.lastEventId,
            normalizedSql: validateAction.normalizedSql,
            normalizedSqlChanged: validateAction.normalizedSqlChanged,
            stage: validateAction.stage,
            status: validateAction.status,
            version: validateAction.version,
          }
        : null,
    }).toMatchSnapshot();
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
