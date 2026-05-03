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
  workflowJournal,
  workflowEffectDispatches,
} from "@onequery/db/server";
import type { Database, DatabaseCredentials } from "@onequery/db/server";
import type { Result as ResultType } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import type {
  CliQueryExecutionDispatch,
  CliQueryValidationDispatch,
} from "./workflow-types";

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

async function selectQueryJournalCommandRows(db: Database) {
  return db
    .select()
    .from(workflowJournal)
    .where(eq(workflowJournal.family, "query_action"))
    .orderBy(asc(workflowJournal.commitPosition), asc(workflowJournal.id))
    .then((rows) => rows.filter((row) => row.entryKind === "command"));
}

async function selectQueryJournalEventRows(db: Database) {
  return db
    .select()
    .from(workflowJournal)
    .where(eq(workflowJournal.family, "query_action"))
    .orderBy(asc(workflowJournal.commitPosition), asc(workflowJournal.id))
    .then((rows) => rows.filter((row) => row.entryKind === "event"));
}

function unwrapOk<T, E>(value: ResultType<T, E>) {
  expect(value.isOk()).toBe(true);
  if (value.isErr()) {
    throw value.error;
  }

  return value.value;
}

async function loadFirstPrepareValidateDispatch(db: Database) {
  const [row] = await db
    .select()
    .from(workflowEffectDispatches)
    .where(eq(workflowEffectDispatches.effectType, "prepare_validate_query"))
    .orderBy(
      asc(workflowEffectDispatches.createdAt),
      asc(workflowEffectDispatches.id)
    )
    .limit(1);

  if (!row) {
    throw new Error("expected a prepare_validate_query dispatch row");
  }

  return row;
}

async function loadWorkflowEffectDispatch(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(workflowEffectDispatches)
    .where(eq(workflowEffectDispatches.id, id))
    .limit(1);

  if (!row) {
    throw new Error(`expected workflow effect dispatch ${id} to be present`);
  }

  return row;
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
    const commandRows = await selectQueryJournalCommandRows(db);
    const actionRow = await db.query.queryActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await selectQueryJournalEventRows(db);
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
      source: {
        displayName: source.displayName,
        id: source.id,
        provider: source.provider,
        sourceKey: source.sourceKey,
        status: source.status,
      },
      sourceName: "warehouse",
      timeoutMs: 5_000,
      truncated: false,
    });
    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_validate",
      "record_validate_preparation_accepted",
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
    expect(eventRows.map((row) => row.payloadType)).toEqual([
      "action_received",
      "source_loaded",
      "query_validated",
    ]);
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([{ effectType: "prepare_validate_query", status: "completed" }]);
  });

  it("records executeQuery through query_action storage and schedules usage persistence", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;
    const persistUsage = vi
      .fn<() => Promise<CliPersistUsageEffectResult>>()
      .mockRejectedValue(
        new Error("persistUsage should not run before response")
      );

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
        persistUsage,
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
    const commandRows = await selectQueryJournalCommandRows(db);
    const actionRow = await db.query.queryActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await selectQueryJournalEventRows(db);
    const journalRows = await db
      .select()
      .from(workflowJournal)
      .orderBy(asc(workflowJournal.streamPosition));
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
    });
    expect(persistUsage).not.toHaveBeenCalled();
    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
    ]);
    expect(actionRow).toMatchObject({
      failureCode: null,
      outcome: "pending",
      phase: "persist_usage",
      queryMode: "execute",
      queryText: "select 42 as answer",
      usageRecordingStatus: "not_started",
      validatedQuery: "select 42 as answer",
    });
    expect(eventRows.map((row) => row.payloadType)).toEqual([
      "action_received",
      "source_loaded",
      "query_validated",
      "credentials_loaded",
      "query_executed",
    ]);
    expect(
      journalRows.map((row) => ({
        entryKind: row.entryKind,
        payloadType: row.payloadType,
      }))
    ).toEqual([
      { entryKind: "command", payloadType: "start_execute" },
      { entryKind: "event", payloadType: "action_received" },
      { entryKind: "effect_scheduled", payloadType: "prepare_execute_query" },
      {
        entryKind: "command",
        payloadType: "record_execute_preparation_succeeded",
      },
      { entryKind: "event", payloadType: "source_loaded" },
      { entryKind: "event", payloadType: "query_validated" },
      { entryKind: "event", payloadType: "credentials_loaded" },
      { entryKind: "effect_scheduled", payloadType: "execute_query" },
      { entryKind: "effect_completed", payloadType: "effect_completed" },
      {
        entryKind: "command",
        payloadType: "record_query_execution_succeeded",
      },
      { entryKind: "event", payloadType: "query_executed" },
      { entryKind: "effect_scheduled", payloadType: "persist_usage" },
      { entryKind: "effect_completed", payloadType: "effect_completed" },
    ]);
    expect(
      journalRows
        .map((row) => row.payloadBytes?.toString("utf8") ?? "")
        .join("\n")
    ).not.toContain("postgres://example");
    expect(
      journalRows
        .map((row) => row.payloadBytes?.toString("utf8") ?? "")
        .join("\n")
    ).not.toContain("encrypted");
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      { effectType: "prepare_execute_query", status: "completed" },
      { effectType: "execute_query", status: "completed" },
      { effectType: "persist_usage", status: "pending" },
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
    const commandRows = await selectQueryJournalCommandRows(db);
    const actionRow = await db.query.queryActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await selectQueryJournalEventRows(db);
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
    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_validate",
      "record_validate_preparation_failed",
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
    expect(eventRows.map((row) => row.payloadType)).toEqual([
      "action_received",
      "source_loaded",
      "query_preparation_failed",
    ]);
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([{ effectType: "prepare_validate_query", status: "completed" }]);
  });

  it("replays completed validateQuery requests from the journal after effect dispatch rows are removed", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const firstResult = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource: vi.fn().mockResolvedValue({
          kind: "found",
          source,
        } satisfies CliLoadSourceEffectResult),
        validateQuery: vi.fn().mockResolvedValue({
          kind: "query_ready",
          normalizedSql: "select 1",
          truncated: false,
        } satisfies CliValidateQueryEffectResult),
      },
      org,
      requestId: "req-validate-replay-1",
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });

    await db.delete(workflowEffectDispatches);

    const replayResult = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource: vi
          .fn<() => Promise<CliLoadSourceEffectResult>>()
          .mockRejectedValue(new Error("loadSource should not run on replay")),
        validateQuery: vi
          .fn<() => Promise<CliValidateQueryEffectResult>>()
          .mockRejectedValue(
            new Error("validateQuery should not run on replay")
          ),
      },
      org,
      requestId: "req-validate-replay-1",
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });

    expect(unwrapOk(replayResult)).toEqual(unwrapOk(firstResult));

    const commandRows = await selectQueryJournalCommandRows(db);

    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_validate",
      "record_validate_preparation_accepted",
    ]);

    const dispatchRows = await db
      .select()
      .from(workflowEffectDispatches)
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(
      dispatchRows.map((row) => ({
        attemptCount: row.attemptCount,
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([]);
    expect(
      dispatchRows.map((row) => ({
        lastErrorCode: row.lastErrorCode,
        lastErrorDetail: row.lastErrorDetail,
        leasedUntil: row.leasedUntil,
      }))
    ).toEqual([]);
  });

  it("releases failed dispatches back to pending and retries them", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const loadSource = vi
      .fn<() => Promise<CliLoadSourceEffectResult>>()
      .mockRejectedValueOnce(
        new Error("source backend temporarily unavailable")
      )
      .mockResolvedValueOnce({
        kind: "found",
        source,
      } satisfies CliLoadSourceEffectResult);
    const validateQuery = vi.fn().mockResolvedValue({
      kind: "query_ready",
      normalizedSql: "select 1",
      truncated: false,
    } satisfies CliValidateQueryEffectResult);

    const failedResult = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource,
        validateQuery,
      },
      org,
      requestId: "req-validate-dispatch-retry-1",
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });

    expect(failedResult.isErr()).toBe(true);

    const failedDispatch = await loadFirstPrepareValidateDispatch(db);
    expect(failedDispatch).toMatchObject({
      attemptCount: 0,
      completedAt: null,
      effectType: "prepare_validate_query",
      lastErrorCode: "dispatch_failed",
      leasedUntil: null,
      status: "pending",
    });
    expect(failedDispatch.lastErrorDetail).toContain(
      "source backend temporarily unavailable"
    );

    const retriedResult = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource,
        validateQuery,
      },
      org,
      requestId: "req-validate-dispatch-retry-1",
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });

    expect(unwrapOk(retriedResult)).toMatchObject({
      kind: "ready",
      normalizedSql: "select 1",
    });
    expect(loadSource).toHaveBeenCalledTimes(2);
    expect(validateQuery).toHaveBeenCalledTimes(1);

    const retriedPreparationDispatch = await loadWorkflowEffectDispatch(
      db,
      failedDispatch.id
    );
    expect(retriedPreparationDispatch).toMatchObject({
      attemptCount: 1,
      effectType: "prepare_validate_query",
      lastErrorCode: null,
      lastErrorDetail: null,
      leasedUntil: null,
      status: "completed",
    });
    expect(retriedPreparationDispatch.completedAt).toBeInstanceOf(Date);

    const dispatchRows = await db
      .select()
      .from(workflowEffectDispatches)
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(
      dispatchRows.map((row) => ({
        attemptCount: row.attemptCount,
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      {
        attemptCount: 1,
        effectType: "prepare_validate_query",
        status: "completed",
      },
    ]);

    const journalRows = await db
      .select()
      .from(workflowJournal)
      .orderBy(asc(workflowJournal.streamPosition));
    expect(
      journalRows.map((row) => ({
        entryKind: row.entryKind,
        payloadType: row.payloadType,
      }))
    ).toEqual([
      { entryKind: "command", payloadType: "start_validate" },
      { entryKind: "event", payloadType: "action_received" },
      { entryKind: "effect_scheduled", payloadType: "prepare_validate_query" },
      { entryKind: "effect_failed", payloadType: "effect_failed" },
      { entryKind: "effect_started", payloadType: "effect_started" },
      {
        entryKind: "command",
        payloadType: "record_validate_preparation_accepted",
      },
      { entryKind: "event", payloadType: "source_loaded" },
      { entryKind: "event", payloadType: "query_validated" },
      { entryKind: "effect_completed", payloadType: "effect_completed" },
    ]);
  });

  it.each(["pending", "leased"] as const)(
    "reconciles a %s dispatch row when replay finds a stored effect result",
    async (status) => {
      const db = await createTestDb();
      openedDatabases.push(db as ClosableDatabase);

      const firstResult = await runCliQueryValidationWorkflowResult({
        actorSnapshot,
        db,
        dispatch: {
          loadSource: vi.fn().mockResolvedValue({
            kind: "found",
            source,
          } satisfies CliLoadSourceEffectResult),
          validateQuery: vi.fn().mockResolvedValue({
            kind: "query_ready",
            normalizedSql: "select 1",
            truncated: false,
          } satisfies CliValidateQueryEffectResult),
        },
        org,
        requestId: `req-validate-reconcile-${status}-1`,
        sourceName: source.sourceKey,
        sql: "select 1",
        timeoutMs: 5_000,
      });
      const firstValue = unwrapOk(firstResult);

      const preparationDispatch = await loadFirstPrepareValidateDispatch(db);
      expect(preparationDispatch).toMatchObject({
        effectType: "prepare_validate_query",
        status: "completed",
      });

      await db
        .update(workflowEffectDispatches)
        .set({
          completedAt: null,
          lastErrorCode: status === "pending" ? "dispatch_failed" : null,
          lastErrorDetail:
            status === "pending" ? "previous dispatch failure" : null,
          leasedUntil:
            status === "leased" ? new Date(Date.now() + 30_000) : null,
          status,
        })
        .where(eq(workflowEffectDispatches.id, preparationDispatch.id));

      const replayResult = await runCliQueryValidationWorkflowResult({
        actorSnapshot,
        db,
        dispatch: {
          loadSource: vi
            .fn<() => Promise<CliLoadSourceEffectResult>>()
            .mockRejectedValue(
              new Error("loadSource should not run on replay")
            ),
          validateQuery: vi
            .fn<() => Promise<CliValidateQueryEffectResult>>()
            .mockRejectedValue(
              new Error("validateQuery should not run on replay")
            ),
        },
        org,
        requestId: `req-validate-reconcile-${status}-1`,
        sourceName: source.sourceKey,
        sql: "select 1",
        timeoutMs: 5_000,
      });

      expect(unwrapOk(replayResult)).toEqual(firstValue);

      const reconciledDispatch = await loadWorkflowEffectDispatch(
        db,
        preparationDispatch.id
      );
      expect(reconciledDispatch).toMatchObject({
        effectType: "prepare_validate_query",
        lastErrorCode: null,
        lastErrorDetail: null,
        leasedUntil: null,
        status: "completed",
      });
      expect(reconciledDispatch.completedAt).toBeInstanceOf(Date);
    }
  );

  it("does not replay validateQuery when a reused request id carries different SQL", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const loadSource = vi.fn().mockResolvedValue({
      kind: "found",
      source,
    } satisfies CliLoadSourceEffectResult);
    const validateQuery = vi.fn(
      async (
        input: Parameters<CliQueryValidationDispatch["validateQuery"]>[0]
      ) => ({
        kind: "query_ready" as const,
        normalizedSql: input.sql.toUpperCase(),
        truncated: false,
      })
    );

    const firstResult = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource,
        validateQuery,
      },
      org,
      requestId: "req-validate-same-id-1",
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });
    const secondResult = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource,
        validateQuery,
      },
      org,
      requestId: "req-validate-same-id-1",
      sourceName: source.sourceKey,
      sql: "select 2",
      timeoutMs: 5_000,
    });

    expect(unwrapOk(firstResult)).toMatchObject({
      normalizedSql: "SELECT 1",
    });
    expect(unwrapOk(secondResult)).toMatchObject({
      normalizedSql: "SELECT 2",
    });
    expect(loadSource).toHaveBeenCalledTimes(2);
    expect(validateQuery).toHaveBeenCalledTimes(2);

    const commandRows = await selectQueryJournalCommandRows(db);

    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_validate",
      "record_validate_preparation_accepted",
      "start_validate",
      "record_validate_preparation_accepted",
    ]);
  });

  it("replays executed executeQuery requests without rerunning the query", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;

    const executeSql = vi.fn().mockResolvedValue({
      elapsedMs: 12,
      kind: "succeeded",
      rows: [{ answer: 42 }],
    } satisfies CliQueryExecutionResult);
    const persistUsage = vi.fn().mockResolvedValue({
      kind: "usage_persisted",
    } satisfies CliPersistUsageEffectResult);

    const firstResult = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql,
        loadCredentials: vi.fn().mockResolvedValue({
          credentials: fakeCredentials,
          kind: "credentials_loaded",
          source,
        } satisfies CliLoadCredentialsEffectResult),
        loadSource: vi.fn().mockResolvedValue({
          kind: "found",
          source,
        } satisfies CliLoadSourceEffectResult),
        persistUsage,
        validateQuery: vi.fn().mockResolvedValue({
          kind: "query_ready",
          normalizedSql: "select 42 as answer",
          truncated: false,
        } satisfies CliValidateQueryEffectResult),
      },
      org,
      requestId: "req-execute-replay-1",
      sourceName: source.sourceKey,
      sql: "select 42 as answer",
      timeoutMs: 30_000,
    });

    const replayResult = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql: vi
          .fn<() => Promise<CliQueryExecutionResult>>()
          .mockRejectedValue(new Error("executeSql should not run on replay")),
        loadCredentials: vi
          .fn<() => Promise<CliLoadCredentialsEffectResult>>()
          .mockRejectedValue(
            new Error("loadCredentials should not run on replay")
          ),
        loadSource: vi
          .fn<() => Promise<CliLoadSourceEffectResult>>()
          .mockRejectedValue(new Error("loadSource should not run on replay")),
        persistUsage: vi
          .fn<() => Promise<CliPersistUsageEffectResult>>()
          .mockRejectedValue(
            new Error("persistUsage should not run on replay")
          ),
        validateQuery: vi
          .fn<() => Promise<CliValidateQueryEffectResult>>()
          .mockRejectedValue(
            new Error("validateQuery should not run on replay")
          ),
      },
      org,
      requestId: "req-execute-replay-1",
      sourceName: source.sourceKey,
      sql: "select 42 as answer",
      timeoutMs: 30_000,
    });

    expect(unwrapOk(replayResult)).toEqual(unwrapOk(firstResult));
    expect(executeSql).toHaveBeenCalledTimes(1);
    expect(persistUsage).not.toHaveBeenCalled();

    const commandRows = await selectQueryJournalCommandRows(db);

    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
    ]);
  });

  it("replays executed executeQuery requests from the journal after workflow_commands and effect dispatch rows are removed", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;

    const executeSql = vi.fn().mockResolvedValue({
      elapsedMs: 12,
      kind: "succeeded",
      rows: [{ answer: 42 }],
    } satisfies CliQueryExecutionResult);
    const persistUsage = vi.fn().mockResolvedValue({
      kind: "usage_persisted",
    } satisfies CliPersistUsageEffectResult);

    const firstResult = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql,
        loadCredentials: vi.fn().mockResolvedValue({
          credentials: fakeCredentials,
          kind: "credentials_loaded",
          source,
        } satisfies CliLoadCredentialsEffectResult),
        loadSource: vi.fn().mockResolvedValue({
          kind: "found",
          source,
        } satisfies CliLoadSourceEffectResult),
        persistUsage,
        validateQuery: vi.fn().mockResolvedValue({
          kind: "query_ready",
          normalizedSql: "select 42 as answer",
          truncated: false,
        } satisfies CliValidateQueryEffectResult),
      },
      org,
      requestId: "req-execute-journal-replay-1",
      sourceName: source.sourceKey,
      sql: "select 42 as answer",
      timeoutMs: 30_000,
    });
    const firstValue = unwrapOk(firstResult);
    await db.delete(workflowEffectDispatches);

    const replayResult = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql: vi
          .fn<() => Promise<CliQueryExecutionResult>>()
          .mockRejectedValue(new Error("executeSql should not run on replay")),
        loadCredentials: vi
          .fn<() => Promise<CliLoadCredentialsEffectResult>>()
          .mockRejectedValue(
            new Error("loadCredentials should not run on replay")
          ),
        loadSource: vi
          .fn<() => Promise<CliLoadSourceEffectResult>>()
          .mockRejectedValue(new Error("loadSource should not run on replay")),
        persistUsage: vi
          .fn<() => Promise<CliPersistUsageEffectResult>>()
          .mockRejectedValue(
            new Error("persistUsage should not run on replay")
          ),
        validateQuery: vi
          .fn<() => Promise<CliValidateQueryEffectResult>>()
          .mockRejectedValue(
            new Error("validateQuery should not run on replay")
          ),
      },
      org,
      requestId: "req-execute-journal-replay-1",
      sourceName: source.sourceKey,
      sql: "select 42 as answer",
      timeoutMs: 30_000,
    });

    expect(unwrapOk(replayResult)).toEqual(firstValue);
    expect(executeSql).toHaveBeenCalledTimes(1);

    const commandRows = await selectQueryJournalCommandRows(db);
    const dispatchRows = await db.select().from(workflowEffectDispatches);
    const eventRows = await selectQueryJournalEventRows(db);
    const journalRows = await db.select().from(workflowJournal);

    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
    ]);
    expect(dispatchRows).toHaveLength(0);
    expect(eventRows.map((row) => row.payloadType)).toEqual([
      "action_received",
      "source_loaded",
      "query_validated",
      "credentials_loaded",
      "query_executed",
    ]);
    expect(journalRows.length).toBeGreaterThan(0);
  });

  it("does not replay executeQuery when a reused request id carries a different timeout", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;

    const executeSql = vi.fn(
      async (
        input: Parameters<CliQueryExecutionDispatch["executeSql"]>[0]
      ) => ({
        elapsedMs: input.clientTimeoutMs,
        kind: "succeeded" as const,
        rows: [{ timeout_ms: input.clientTimeoutMs }],
      })
    );
    const persistUsage = vi.fn().mockResolvedValue({
      kind: "usage_persisted",
    } satisfies CliPersistUsageEffectResult);

    const firstResult = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql,
        loadCredentials: vi.fn().mockResolvedValue({
          credentials: fakeCredentials,
          kind: "credentials_loaded",
          source,
        } satisfies CliLoadCredentialsEffectResult),
        loadSource: vi.fn().mockResolvedValue({
          kind: "found",
          source,
        } satisfies CliLoadSourceEffectResult),
        persistUsage,
        validateQuery: vi.fn().mockResolvedValue({
          kind: "query_ready",
          normalizedSql: "select 42",
          truncated: false,
        } satisfies CliValidateQueryEffectResult),
      },
      org,
      requestId: "req-execute-same-id-1",
      sourceName: source.sourceKey,
      sql: "select 42",
      timeoutMs: 1_000,
    });
    const secondResult = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql,
        loadCredentials: vi.fn().mockResolvedValue({
          credentials: fakeCredentials,
          kind: "credentials_loaded",
          source,
        } satisfies CliLoadCredentialsEffectResult),
        loadSource: vi.fn().mockResolvedValue({
          kind: "found",
          source,
        } satisfies CliLoadSourceEffectResult),
        persistUsage,
        validateQuery: vi.fn().mockResolvedValue({
          kind: "query_ready",
          normalizedSql: "select 42",
          truncated: false,
        } satisfies CliValidateQueryEffectResult),
      },
      org,
      requestId: "req-execute-same-id-1",
      sourceName: source.sourceKey,
      sql: "select 42",
      timeoutMs: 2_000,
    });

    expect(unwrapOk(firstResult)).toMatchObject({
      kind: "response_ready",
      response: {
        elapsedMs: 1_000,
      },
    });
    expect(unwrapOk(secondResult)).toMatchObject({
      kind: "response_ready",
      response: {
        elapsedMs: 2_000,
      },
    });
    expect(executeSql).toHaveBeenCalledTimes(2);
    expect(persistUsage).not.toHaveBeenCalled();

    const commandRows = await selectQueryJournalCommandRows(db);

    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
    ]);
  });
});
