import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  asc,
  createDb,
  eq,
  organization,
  pendingWorkflowEffects,
  prepareApplicationDatabase,
  workflowJournal,
} from "@onequery/db/server";
import type { Database, DatabaseCredentials } from "@onequery/db/server";
import { createStableValueFingerprint } from "@onequery/server/lib/stable-fingerprint";
import type { Result as ResultType } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkflowActorSnapshot } from "../../../audit";
import {
  claimFailedQueryActionEffectViaJournal,
  rebuildPendingQueryActionEffectsViaJournal,
} from "../../../audit/storage";
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
import { createQueryWorkflowResourceCache } from "./resource-cache";
import {
  recoverPendingQueryUsagePersistenceEffects,
  runCliQueryExecutionWorkflowResult,
  runCliQueryValidationWorkflowResult,
} from "./workflow";
import { storeAcceptedQueryActionCommand } from "./workflow-runtime";
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

async function waitForFollowUpTimers() {
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

function buildStartQueryCommandInvocationId(input: {
  mode: "start_execute" | "start_validate";
  organizationId: string;
  requestId: string;
  sourceName: string;
  sql: string;
  timeoutMs: number;
}) {
  const fingerprint = createStableValueFingerprint({
    mode: input.mode,
    organizationId: input.organizationId,
    sourceName: input.sourceName,
    sql: input.sql,
    timeoutMs: input.timeoutMs,
  });

  return `query_action:${input.requestId}:${input.mode}:${fingerprint}`;
}

describe("query workflow audit runtime", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    await waitForFollowUpTimers();
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
  });

  it("uses cached source misses without dispatching loadSource", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const loadSource = vi
      .fn<() => Promise<CliLoadSourceEffectResult>>()
      .mockRejectedValue(new Error("loadSource should not run"));
    const validateQuery = vi
      .fn<() => Promise<CliValidateQueryEffectResult>>()
      .mockRejectedValue(new Error("validateQuery should not run"));

    const result = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource,
        validateQuery,
      },
      org,
      requestId: "req-validate-cached-miss-1",
      resourceCache: createQueryWorkflowResourceCache({
        organizationId: org.id,
        sourceKey: source.sourceKey,
        sourceLookup: {
          kind: "not_found",
        },
      }),
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });

    expect(unwrapOk(result)).toMatchObject({
      kind: "source_not_found",
      orgSlug: org.slug,
      requestId: "req-validate-cached-miss-1",
      sourceName: source.sourceKey,
    });
    expect(loadSource).not.toHaveBeenCalled();
    expect(validateQuery).not.toHaveBeenCalled();

    const commandRows = await selectQueryJournalCommandRows(db);
    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_validate",
      "record_validate_preparation_source_not_found",
    ]);
  });

  it("records executeQuery and persists usage as an asynchronous follow-up", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;
    const persistUsage = vi.fn().mockResolvedValue({
      kind: "usage_persisted",
    } satisfies CliPersistUsageEffectResult);
    const loadSource = vi.fn().mockResolvedValue({
      kind: "found",
      source,
    } satisfies CliLoadSourceEffectResult);
    const executeSql = vi.fn(
      async (): Promise<CliQueryExecutionResult> => ({
        elapsedMs: 12,
        kind: "succeeded",
        rows: [{ answer: 42 }],
      })
    );
    const resourceCache = createQueryWorkflowResourceCache({
      organizationId: org.id,
      sourceKey: source.sourceKey,
      sourceLookup: {
        kind: "found",
        source,
      },
    });

    const result = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql,
        loadCredentials: async (): Promise<CliLoadCredentialsEffectResult> => ({
          credentials: fakeCredentials,
          kind: "credentials_loaded",
          source,
        }),
        loadSource,
        persistUsage,
        validateQuery: async (): Promise<CliValidateQueryEffectResult> => ({
          kind: "query_ready",
          normalizedSql: "select 42 as answer",
          truncated: false,
        }),
      },
      org,
      requestId: "req-execute-1",
      resourceCache,
      sourceName: source.sourceKey,
      sql: "select 42 as answer",
      timeoutMs: 30_000,
    });

    if (result.isErr()) {
      throw result.error;
    }
    const execution = unwrapOk(result);
    expect(execution).toMatchObject({
      kind: "response_ready",
      response: {
        elapsedMs: 12,
        rowCount: 1,
        truncated: false,
      },
    });
    await waitForFollowUpTimers();

    const commandRows = await selectQueryJournalCommandRows(db);
    const actionRow = await db.query.queryActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await selectQueryJournalEventRows(db);
    const journalRows = await db
      .select()
      .from(workflowJournal)
      .orderBy(asc(workflowJournal.streamPosition));
    const pendingEffectRows = await db
      .select()
      .from(pendingWorkflowEffects)
      .orderBy(asc(pendingWorkflowEffects.scheduledAt));

    expect(persistUsage).toHaveBeenCalledTimes(1);
    expect(loadSource).not.toHaveBeenCalled();
    expect(executeSql).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: actionRow?.id,
        requestId: "req-execute-1",
      })
    );
    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
      "record_usage_persistence_succeeded",
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
    expect(eventRows.map((row) => row.payloadType)).toEqual([
      "action_received",
      "source_loaded",
      "query_validated",
      "credentials_loaded",
      "query_executed",
      "usage_persisted",
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
      { entryKind: "checkpoint", payloadType: "preparing" },
      {
        entryKind: "command",
        payloadType: "record_execute_preparation_succeeded",
      },
      { entryKind: "event", payloadType: "source_loaded" },
      { entryKind: "event", payloadType: "query_validated" },
      { entryKind: "event", payloadType: "credentials_loaded" },
      { entryKind: "effect_scheduled", payloadType: "execute_query" },
      { entryKind: "effect_completed", payloadType: "effect_completed" },
      { entryKind: "checkpoint", payloadType: "executing" },
      {
        entryKind: "command",
        payloadType: "record_query_execution_succeeded",
      },
      { entryKind: "event", payloadType: "query_executed" },
      { entryKind: "effect_scheduled", payloadType: "persist_usage" },
      { entryKind: "effect_completed", payloadType: "effect_completed" },
      { entryKind: "checkpoint", payloadType: "query_succeeded" },
      {
        entryKind: "command",
        payloadType: "record_usage_persistence_succeeded",
      },
      { entryKind: "event", payloadType: "usage_persisted" },
      { entryKind: "effect_completed", payloadType: "effect_completed" },
      { entryKind: "checkpoint", payloadType: "usage_persisted" },
    ]);
    expect(
      pendingEffectRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([]);
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
  });

  it("executes an unhealthy source when its provider exposes query", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const erroredSource: CliQuerySourceRecord = {
      ...source,
      id: "source_error",
      name: "broken_warehouse",
      sourceKey: "broken_warehouse",
      status: "error",
    };
    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;
    const validateQuery = vi.fn(
      async (): Promise<CliValidateQueryEffectResult> => ({
        kind: "query_ready",
        normalizedSql: "select 1",
        truncated: false,
      })
    );
    const executeSql = vi.fn(
      async (): Promise<CliQueryExecutionResult> => ({
        elapsedMs: 10,
        kind: "succeeded",
        rows: [{ "?column?": 1 }],
      })
    );

    const result = await runCliQueryExecutionWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        executeSql,
        loadCredentials: async (): Promise<CliLoadCredentialsEffectResult> => ({
          credentials: fakeCredentials,
          kind: "credentials_loaded",
          source: erroredSource,
        }),
        loadSource: vi
          .fn<() => Promise<CliLoadSourceEffectResult>>()
          .mockRejectedValue(new Error("loadSource should not run")),
        persistUsage: async (): Promise<CliPersistUsageEffectResult> => ({
          kind: "usage_persisted",
        }),
        validateQuery,
      },
      org,
      requestId: "req-execute-error-status-1",
      resourceCache: createQueryWorkflowResourceCache({
        organizationId: org.id,
        sourceKey: erroredSource.sourceKey,
        sourceLookup: {
          kind: "found",
          source: erroredSource,
        },
      }),
      sourceName: erroredSource.sourceKey,
      sql: "select 1",
      timeoutMs: 30_000,
    });

    expect(unwrapOk(result)).toMatchObject({
      kind: "response_ready",
      response: {
        source: {
          sourceKey: erroredSource.sourceKey,
          status: "error",
        },
      },
    });
    expect(validateQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseType: "postgres",
      })
    );
    expect(executeSql).toHaveBeenCalledTimes(1);
  });

  it("recovers pending usage persistence from journal state after query response", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;
    const persistUsage = vi.fn().mockResolvedValue({
      kind: "usage_persisted",
    } satisfies CliPersistUsageEffectResult);

    vi.useFakeTimers();
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
      requestId: "req-execute-usage-recovery-1",
      sourceName: source.sourceKey,
      sql: "select 42 as answer",
      timeoutMs: 30_000,
    });
    vi.useRealTimers();

    expect(unwrapOk(result)).toMatchObject({
      kind: "response_ready",
    });
    expect(persistUsage).not.toHaveBeenCalled();

    const pendingBefore = await db.select().from(pendingWorkflowEffects);
    expect(pendingBefore.map((row) => row.effectType)).toEqual([
      "persist_usage",
    ]);

    const recovered = await recoverPendingQueryUsagePersistenceEffects({
      actorSnapshot,
      db,
      dispatch: {
        persistUsage,
      },
      requestId: "req-execute-usage-recovery-worker-1",
    });

    expect(recovered).toEqual({
      failed: 0,
      recovered: 1,
      skipped: 0,
    });
    expect(persistUsage).toHaveBeenCalledTimes(1);

    const pendingAfter = await db.select().from(pendingWorkflowEffects);
    expect(pendingAfter).toEqual([]);

    const journalRows = await db
      .select()
      .from(workflowJournal)
      .orderBy(asc(workflowJournal.streamPosition));
    expect(
      journalRows.map((row) => ({
        entryKind: row.entryKind,
        payloadType: row.payloadType,
      }))
    ).toContainEqual({
      entryKind: "effect_started",
      payloadType: "effect_started",
    });
    expect(
      journalRows.map((row) => ({
        entryKind: row.entryKind,
        payloadType: row.payloadType,
      }))
    ).toContainEqual({
      entryKind: "event",
      payloadType: "usage_persisted",
    });
  });

  it("recovers leased usage persistence effects after a worker crash", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const fakeCredentials = {
      connectionString: "postgres://example",
      provider: "postgres",
    } as unknown as DatabaseCredentials;
    const persistUsage = vi.fn().mockResolvedValue({
      kind: "usage_persisted",
    } satisfies CliPersistUsageEffectResult);

    vi.useFakeTimers();
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
      requestId: "req-execute-usage-leased-recovery-1",
      sourceName: source.sourceKey,
      sql: "select 42 as answer",
      timeoutMs: 30_000,
    });
    vi.useRealTimers();

    expect(unwrapOk(result)).toMatchObject({
      kind: "response_ready",
    });

    const [pendingUsageEffect] = await db.select().from(pendingWorkflowEffects);
    if (pendingUsageEffect === undefined) {
      throw new Error("expected pending usage persistence effect");
    }

    const claimed = await claimFailedQueryActionEffectViaJournal({
      actionId: pendingUsageEffect.streamId,
      db,
      effectId: pendingUsageEffect.effectId,
      organizationId: org.id,
    });
    expect(claimed.isOk()).toBe(true);

    let pendingEffectRows = await db.select().from(pendingWorkflowEffects);
    expect(
      pendingEffectRows.map((row) => ({
        attemptCount: row.attemptCount,
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      {
        attemptCount: 1,
        effectType: "persist_usage",
        status: "leased",
      },
    ]);

    await db.delete(pendingWorkflowEffects);
    const rebuilt = await rebuildPendingQueryActionEffectsViaJournal({ db });
    expect(rebuilt.isOk()).toBe(true);
    pendingEffectRows = await db.select().from(pendingWorkflowEffects);
    expect(
      pendingEffectRows.map((row) => ({
        attemptCount: row.attemptCount,
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      {
        attemptCount: 1,
        effectType: "persist_usage",
        status: "leased",
      },
    ]);

    const recovered = await recoverPendingQueryUsagePersistenceEffects({
      actorSnapshot,
      db,
      dispatch: {
        persistUsage,
      },
      requestId: "req-execute-usage-leased-recovery-worker-1",
    });

    expect(recovered).toEqual({
      failed: 0,
      recovered: 1,
      skipped: 0,
    });
    expect(persistUsage).toHaveBeenCalledTimes(1);

    const pendingAfter = await db.select().from(pendingWorkflowEffects);
    expect(pendingAfter).toEqual([]);

    const journalRows = await db
      .select()
      .from(workflowJournal)
      .orderBy(asc(workflowJournal.streamPosition));
    expect(
      journalRows.map((row) => ({
        entryKind: row.entryKind,
        payloadType: row.payloadType,
      }))
    ).toEqual(
      expect.arrayContaining([
        { entryKind: "effect_failed", payloadType: "effect_failed" },
        { entryKind: "effect_started", payloadType: "effect_started" },
        { entryKind: "event", payloadType: "usage_persisted" },
      ])
    );
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
  });

  it("replays completed validateQuery requests from the journal", async () => {
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
  });

  it("records failed inline effects in the journal and retries them without pending projection", async () => {
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
    let pendingEffectRows = await db
      .select()
      .from(pendingWorkflowEffects)
      .orderBy(asc(pendingWorkflowEffects.scheduledAt));
    expect(
      pendingEffectRows.map((row) => ({
        attemptCount: row.attemptCount,
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([]);
    await db.delete(pendingWorkflowEffects);
    const rebuilt = await rebuildPendingQueryActionEffectsViaJournal({ db });
    expect(rebuilt.isOk()).toBe(true);
    pendingEffectRows = await db
      .select()
      .from(pendingWorkflowEffects)
      .orderBy(asc(pendingWorkflowEffects.scheduledAt));
    expect(
      pendingEffectRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([]);

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
    pendingEffectRows = await db
      .select()
      .from(pendingWorkflowEffects)
      .orderBy(asc(pendingWorkflowEffects.scheduledAt));
    expect(pendingEffectRows).toEqual([]);

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
      { entryKind: "checkpoint", payloadType: "preparing" },
      { entryKind: "effect_failed", payloadType: "effect_failed" },
      { entryKind: "effect_started", payloadType: "effect_started" },
      {
        entryKind: "command",
        payloadType: "record_validate_preparation_accepted",
      },
      { entryKind: "event", payloadType: "source_loaded" },
      { entryKind: "event", payloadType: "query_validated" },
      { entryKind: "effect_completed", payloadType: "effect_completed" },
      { entryKind: "checkpoint", payloadType: "query_validated" },
    ]);
  });

  it("claims scheduled journal effects when recovering after scheduling", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);

    const requestId = "req-validate-scheduled-recovery-1";
    const startDecision = await storeAcceptedQueryActionCommand({
      actionId: null,
      actorSnapshot,
      causedByEventId: null,
      commandInvocationId: buildStartQueryCommandInvocationId({
        mode: "start_validate",
        organizationId: org.id,
        requestId,
        sourceName: source.sourceKey,
        sql: "select 1",
        timeoutMs: 5_000,
      }),
      commandPayload: {
        queryText: "select 1",
        sourceKey: source.sourceKey,
        type: "start_validate",
      },
      db,
      organizationId: org.id,
      requestId,
      surface: "cli",
    });
    expect(
      startDecision.freshEffects.map((effect) => effect.effectType)
    ).toEqual(["prepare_validate_query"]);

    const loadSource = vi.fn().mockResolvedValue({
      kind: "found",
      source,
    } satisfies CliLoadSourceEffectResult);
    const validateQuery = vi.fn().mockResolvedValue({
      kind: "query_ready",
      normalizedSql: "select 1",
      truncated: false,
    } satisfies CliValidateQueryEffectResult);

    const recovered = await runCliQueryValidationWorkflowResult({
      actorSnapshot,
      db,
      dispatch: {
        loadSource,
        validateQuery,
      },
      org,
      requestId,
      sourceName: source.sourceKey,
      sql: "select 1",
      timeoutMs: 5_000,
    });

    expect(unwrapOk(recovered)).toMatchObject({
      kind: "ready",
      normalizedSql: "select 1",
    });
    expect(loadSource).toHaveBeenCalledTimes(1);
    expect(validateQuery).toHaveBeenCalledTimes(1);

    const pendingEffectRows = await db
      .select()
      .from(pendingWorkflowEffects)
      .orderBy(asc(pendingWorkflowEffects.scheduledAt));
    expect(pendingEffectRows).toEqual([]);

    const journalRows = await db
      .select()
      .from(workflowJournal)
      .orderBy(asc(workflowJournal.streamPosition));
    expect(journalRows.map((row) => row.entryKind)).toContain("effect_started");
  });

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
    await waitForFollowUpTimers();
    expect(persistUsage).toHaveBeenCalledTimes(1);

    const commandRows = await selectQueryJournalCommandRows(db);

    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
      "record_usage_persistence_succeeded",
    ]);
  });

  it("replays executed executeQuery requests from the journal", async () => {
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
    const eventRows = await selectQueryJournalEventRows(db);
    const journalRows = await db.select().from(workflowJournal);

    expect(commandRows.map((row) => row.payloadType)).toEqual([
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
    ]);
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
    await waitForFollowUpTimers();
    expect(persistUsage).toHaveBeenCalledTimes(2);

    const commandRows = await selectQueryJournalCommandRows(db);

    expect(
      commandRows
        .map((row) => row.payloadType)
        .filter(
          (payloadType) => payloadType !== "record_usage_persistence_succeeded"
        )
    ).toEqual([
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
      "start_execute",
      "record_execute_preparation_succeeded",
      "record_query_execution_succeeded",
    ]);
  });
});
