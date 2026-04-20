import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  asc,
  createDb,
  organization,
  prepareApplicationDatabase,
  queryActionEvents,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { DatabaseCredentials } from "@onequery/db/server";
import type { Result as ResultType } from "better-result";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowActorSnapshot } from "../../../audit";
import type {
  CliLoadCredentialsEffectResult,
  CliLoadSourceEffectResult,
  CliPersistUsageEffectResult,
  CliValidateQueryEffectResult,
} from "../../../domain/effects";
import type {
  CliQueryExecutionResult,
  CliQuerySourceRecord,
} from "../../../domain/workflows";
import {
  runCliQueryExecutionWorkflowResult,
  runCliQueryValidationWorkflowResult,
} from "./workflow";

type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

const migrationsFolder = fileURLToPath(
  new URL("../../../../../db/src/migrations", import.meta.url)
);

const actorSnapshot: WorkflowActorSnapshot = {
  authMode: "browser_session",
  email: "jane@example.com",
  membershipRoles: ["owner"],
  userId: "user_1",
};

const org = {
  id: "org_1",
  name: "Org One",
  slug: "org-one",
} as const;

const source: CliQuerySourceRecord = {
  credentialsEncrypted: "encrypted",
  credentialsIv: "iv",
  displayName: "Warehouse",
  id: "source_1",
  name: "warehouse",
  organizationId: org.id,
  provider: "postgres",
  sourceKey: "warehouse",
  status: "active",
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

  await db.insert(organization).values(org);

  return db;
}

function unwrapOk<T, E>(value: ResultType<T, E>) {
  expect(value.isOk()).toBe(true);
  if (value.isErr()) {
    throw value.error;
  }

  return value.value;
}

describe("query workflow audit runtime", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("records validateQuery through query_action storage only", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const result = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource: async (): Promise<CliLoadSourceEffectResult> => ({
          kind: "found",
          source,
        }),
        validateQuery: async (): Promise<CliValidateQueryEffectResult> => ({
          kind: "query_ready",
          normalizedSql: "select 1",
          truncated: false,
        }),
      },
      org,
      requestId: "req-validate-1",
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });

    const validation = unwrapOk(result);
    const commandRows = await db
      .select()
      .from(workflowCommands)
      .orderBy(asc(workflowCommands.createdAt), asc(workflowCommands.id));
    const actionRow = await db.query.queryActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await db
      .select()
      .from(queryActionEvents)
      .orderBy(asc(queryActionEvents.sequence));
    const outboxRows = await db
      .select()
      .from(workflowEffectDispatches)
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(validation).toMatchObject({
      kind: "ready",
      normalizedSql: "select 1",
      requestId: "req-validate-1",
      source,
      sourceName: "warehouse",
      timeoutMs: 5_000,
      truncated: false,
    });
    expect(commandRows.map((row) => row.commandType)).toEqual([
      "start_validate",
      "record_source_lookup",
      "record_query_validation",
    ]);
    expect(actionRow).toMatchObject({
      failureCode: null,
      outcome: "succeeded",
      phase: "completed",
      queryMode: "validate",
      queryText: "select 1",
      usageRecordingStatus: "not_started",
      validatedQuery: "select 1",
    });
    expect(eventRows.map((row) => row.eventType)).toEqual([
      "action_received",
      "source_loaded",
      "query_validated",
    ]);
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      { effectType: "load_source", status: "completed" },
      { effectType: "validate_query", status: "completed" },
    ]);
  });

  it("records executeQuery through query_action storage only and completes the outbox chain", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;

    const result = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql: async (): Promise<CliQueryExecutionResult> => ({
          elapsedMs: 12,
          kind: "succeeded",
          rows: [{ answer: 42 }],
        }),
        loadCredentials: async (): Promise<CliLoadCredentialsEffectResult> => ({
          credentials: fakeCredentials,
          kind: "credentials_loaded",
          source,
        }),
        loadSource: async (): Promise<CliLoadSourceEffectResult> => ({
          kind: "found",
          source,
        }),
        persistUsage: async (): Promise<CliPersistUsageEffectResult> => ({
          kind: "usage_persisted",
        }),
        validateQuery: async (): Promise<CliValidateQueryEffectResult> => ({
          kind: "query_ready",
          normalizedSql: "select 42 as answer",
          truncated: false,
        }),
      },
      org,
      requestId: "req-execute-1",
      sourceName: source.sourceKey,
      sql: "select 42 as answer",
      timeoutMs: 30_000,
    });

    const execution = unwrapOk(result);
    const commandRows = await db
      .select()
      .from(workflowCommands)
      .orderBy(asc(workflowCommands.createdAt), asc(workflowCommands.id));
    const actionRow = await db.query.queryActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await db
      .select()
      .from(queryActionEvents)
      .orderBy(asc(queryActionEvents.sequence));
    const outboxRows = await db
      .select()
      .from(workflowEffectDispatches)
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(execution).toMatchObject({
      kind: "response_ready",
      response: {
        elapsedMs: 12,
        rowCount: 1,
        truncated: false,
      },
      usagePersistence: {
        kind: "usage_persisted",
      },
    });
    expect(commandRows.map((row) => row.commandType)).toEqual([
      "start_execute",
      "record_source_lookup",
      "record_query_validation",
      "record_credentials_load",
      "record_query_execution",
      "record_usage_persistence",
    ]);
    expect(actionRow).toMatchObject({
      failureCode: null,
      outcome: "succeeded",
      phase: "completed",
      queryMode: "execute",
      queryText: "select 42 as answer",
      usageRecordingStatus: "succeeded",
      validatedQuery: "select 42 as answer",
    });
    expect(eventRows.map((row) => row.eventType)).toEqual([
      "action_received",
      "source_loaded",
      "query_validated",
      "credentials_loaded",
      "query_executed",
      "usage_persisted",
    ]);
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      { effectType: "load_source", status: "completed" },
      { effectType: "validate_query", status: "completed" },
      { effectType: "load_credentials", status: "completed" },
      { effectType: "execute_query", status: "completed" },
      { effectType: "persist_usage", status: "completed" },
    ]);
  });

  it("records validation preparation failures as query_preparation_failed", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const result = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource: async (): Promise<CliLoadSourceEffectResult> => ({
          kind: "found",
          source,
        }),
        validateQuery: async (): Promise<CliValidateQueryEffectResult> => ({
          detail: "sql parser runtime unavailable",
          hint: "retry the request",
          kind: "query_preparation_failed",
        }),
      },
      org,
      requestId: "req-validate-preparation-failed-1",
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });

    const failure = unwrapOk(result);
    const commandRows = await db
      .select()
      .from(workflowCommands)
      .orderBy(asc(workflowCommands.createdAt), asc(workflowCommands.id));
    const actionRow = await db.query.queryActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await db
      .select()
      .from(queryActionEvents)
      .orderBy(asc(queryActionEvents.sequence));
    const outboxRows = await db
      .select()
      .from(workflowEffectDispatches)
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(failure).toMatchObject({
      detail: "sql parser runtime unavailable",
      hint: "retry the request",
      kind: "query_preparation_failed",
      requestId: "req-validate-preparation-failed-1",
    });
    expect(commandRows.map((row) => row.commandType)).toEqual([
      "start_validate",
      "record_source_lookup",
      "record_query_validation",
    ]);
    expect(actionRow).toMatchObject({
      failureCode: "query_preparation_failed",
      outcome: "failed",
      phase: "completed",
      queryMode: "validate",
      queryText: "select 1",
      usageRecordingStatus: "not_started",
      validatedQuery: null,
    });
    expect(eventRows.map((row) => row.eventType)).toEqual([
      "action_received",
      "source_loaded",
      "query_preparation_failed",
    ]);
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      { effectType: "load_source", status: "completed" },
      { effectType: "validate_query", status: "completed" },
    ]);
  });
});
