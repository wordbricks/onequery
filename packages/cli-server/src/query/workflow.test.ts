import { describe, expect, it, vi } from "vitest";

import {
  finishCliQueryCredentialsLoad,
  finishCliQueryExecution,
  finishCliQuerySourceLookup,
  finishCliQueryValidation,
  runCliQueryExecutionWorkflow,
  runCliQueryValidationWorkflow,
  startCliQueryExecutionWorkflow,
} from "./workflow";

const org = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
};

const postgresSource = {
  credentialsEncrypted: "encrypted",
  credentialsIv: "iv",
  displayName: null,
  id: "source-1",
  name: "warehouse",
  organizationId: "org-1",
  provider: "postgres",
  sourceKey: "warehouse",
  status: "active",
} as const;

describe("cli query execution workflow", () => {
  it("starts by loading the requested source", () => {
    expect(
      startCliQueryExecutionWorkflow({
        org,
        requestId: "req-1",
        sourceName: "warehouse",
        sql: "select 1",
        timeoutMs: undefined,
      })
    ).toEqual({
      kind: "load_source",
      orgSlug: "acme",
      organizationId: "org-1",
      requestId: "req-1",
      sourceName: "warehouse",
      sql: "select 1",
      timeoutMs: null,
    });
  });

  it("rejects non-queryable sources during planning", () => {
    const state = startCliQueryExecutionWorkflow({
      org,
      requestId: "req-2",
      sourceName: "github-main",
      sql: "select 1",
      timeoutMs: 30_000,
    });
    if (state.kind !== "load_source") {
      throw new Error(`unexpected state: ${state.kind}`);
    }

    expect(
      finishCliQuerySourceLookup({
        source: {
          kind: "found",
          source: {
            ...postgresSource,
            sourceKey: "github-main",
            name: "github-main",
            provider: "github",
          },
        },
        state,
      })
    ).toEqual({
      kind: "source_not_queryable",
      provider: "github",
      requestId: "req-2",
      sourceName: "github-main",
      status: "active",
    });
  });

  it("moves valid plans toward credential loading", () => {
    const next = finishCliQuerySourceLookup({
      source: {
        kind: "found",
        source: postgresSource,
      },
      state: {
        kind: "load_source",
        orgSlug: "acme",
        organizationId: "org-1",
        requestId: "req-3",
        sourceName: "warehouse",
        sql: "select * from stats",
        timeoutMs: 15_000,
      },
    });
    if (next.kind !== "validate_query") {
      throw new Error(`unexpected state: ${next.kind}`);
    }

    expect(next).toEqual({
      databaseType: "postgres",
      kind: "validate_query",
      requestId: "req-3",
      source: postgresSource,
      sourceName: "warehouse",
      sql: "select * from stats",
      timeoutMs: 15_000,
    });

    expect(
      finishCliQueryValidation({
        state: next,
        validation: {
          kind: "query_ready",
          normalizedSql: "SELECT * FROM stats LIMIT 1000",
          truncated: true,
        },
      })
    ).toEqual({
      kind: "load_credentials",
      normalizedSql: "SELECT * FROM stats LIMIT 1000",
      requestId: "req-3",
      source: postgresSource,
      sourceName: "warehouse",
      timeoutMs: 15_000,
      truncated: true,
    });
  });

  it("treats credential preparation failures as terminal workflow data", () => {
    expect(
      finishCliQueryCredentialsLoad({
        credentials: {
          kind: "credentials_invalid",
          source: postgresSource,
          detail: "failed to decrypt credentials",
        },
        state: {
          kind: "load_credentials",
          requestId: "req-4",
          sourceName: "warehouse",
          timeoutMs: null,
          source: postgresSource,
          normalizedSql: "SELECT 1",
          truncated: false,
        },
      })
    ).toEqual({
      detail: "failed to decrypt credentials",
      hint: "verify the source configuration and retry",
      kind: "query_preparation_failed",
      requestId: "req-4",
    });
  });

  it("carries retryability as explicit execution result data", () => {
    expect(
      finishCliQueryExecution({
        execution: {
          kind: "query_unavailable",
          detail: "database temporarily unavailable",
          retryable: true,
        },
        state: {
          kind: "execute_query",
          requestId: "req-5",
          sourceName: "warehouse",
          timeoutMs: 10_000,
          source: postgresSource,
          credentials: {
            type: "postgres",
            host: "localhost",
            port: 5432,
            database: "app",
            username: "onequery",
            password: "secret",
            sslMode: "prefer",
          },
          sql: "SELECT 1",
          truncated: false,
        },
      })
    ).toEqual({
      detail: "database temporarily unavailable",
      kind: "query_unavailable",
      requestId: "req-5",
      retryable: true,
    });
  });

  it("keeps usage persistence best-effort in the driver", async () => {
    const loadSource = vi.fn(async () => ({
      kind: "found" as const,
      source: postgresSource,
    }));
    const validateQuery = vi.fn(async () => ({
      kind: "query_ready" as const,
      normalizedSql: "SELECT answer FROM stats LIMIT 1000",
      truncated: true,
    }));
    const loadCredentials = vi.fn(async () => ({
      credentials: {
        type: "postgres" as const,
        host: "localhost",
        port: 5432,
        database: "app",
        username: "onequery",
        password: "secret",
        sslMode: "prefer" as const,
      },
      kind: "credentials_loaded" as const,
      source: postgresSource,
    }));
    const executeSql = vi.fn(async () => ({
      elapsedMs: 18,
      kind: "succeeded" as const,
      rows: [{ answer: 42 }],
    }));
    const persistUsage = vi.fn(async () => ({
      detail: "write unavailable",
      kind: "usage_persist_failed" as const,
      sourceId: "source-1",
    }));

    expect(
      await runCliQueryExecutionWorkflow({
        dispatch: {
          loadSource,
          validateQuery,
          loadCredentials,
          executeSql,
          persistUsage,
        },
        org,
        requestId: "req-6",
        sourceName: "warehouse",
        sql: "select answer from stats",
        timeoutMs: undefined,
      })
    ).toEqual({
      kind: "response_ready",
      response: {
        columns: [{ name: "answer", logicalType: "number" }],
        elapsedMs: 18,
        rowCount: 1,
        rows: [["42"]],
        source: {
          displayName: null,
          id: "source-1",
          provider: "postgres",
          sourceKey: "warehouse",
          status: "active",
        },
        truncated: true,
      },
      usagePersistence: {
        detail: "write unavailable",
        kind: "usage_persist_failed",
        sourceId: "source-1",
      },
    });
  });

  it("emits execution workflow transition events in order", async () => {
    const observeEvent = vi.fn();

    await runCliQueryExecutionWorkflow({
      dispatch: {
        loadSource: async () => ({
          kind: "found" as const,
          source: postgresSource,
        }),
        validateQuery: async () => ({
          kind: "query_ready" as const,
          normalizedSql: "SELECT answer FROM stats LIMIT 1000",
          truncated: true,
        }),
        loadCredentials: async () => ({
          credentials: {
            type: "postgres" as const,
            host: "localhost",
            port: 5432,
            database: "app",
            username: "onequery",
            password: "secret",
            sslMode: "prefer" as const,
          },
          kind: "credentials_loaded" as const,
          source: postgresSource,
        }),
        executeSql: async () => ({
          elapsedMs: 12,
          kind: "succeeded" as const,
          rows: [{ answer: 42 }],
        }),
        persistUsage: async () => ({
          detail: "write unavailable",
          kind: "usage_persist_failed" as const,
          sourceId: "source-1",
        }),
      },
      observeEvent,
      org,
      requestId: "req-9",
      sourceName: "warehouse",
      sql: "select answer from stats",
      timeoutMs: undefined,
    });

    expect(observeEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        actionType: "execute",
        requestId: "req-9",
        source: postgresSource,
        sourceKey: "warehouse",
        type: "source_loaded",
      },
      {
        actionType: "execute",
        normalizedSql: "SELECT answer FROM stats LIMIT 1000",
        normalizedSqlChanged: true,
        requestId: "req-9",
        source: postgresSource,
        sourceKey: "warehouse",
        type: "query_validated",
      },
      {
        actionType: "execute",
        requestId: "req-9",
        source: postgresSource,
        sourceKey: "warehouse",
        type: "credentials_loaded",
      },
      {
        actionType: "execute",
        elapsedMs: 12,
        requestId: "req-9",
        rowCount: 1,
        source: postgresSource,
        sourceKey: "warehouse",
        type: "query_executed",
      },
      {
        actionType: "execute",
        detail: "write unavailable",
        requestId: "req-9",
        sourceId: "source-1",
        sourceKey: "warehouse",
        type: "usage_persist_failed",
      },
    ]);
  });

  it("fails closed when execution trail writes fail", async () => {
    const observeEvent = vi.fn(async () => {
      throw new Error("query action trail unavailable");
    });
    const observeEventFailure = vi.fn();

    await expect(
      runCliQueryExecutionWorkflow({
        dispatch: {
          loadSource: async () => ({
            kind: "found" as const,
            source: postgresSource,
          }),
          validateQuery: async () => ({
            kind: "query_ready" as const,
            normalizedSql: "SELECT answer FROM stats LIMIT 1000",
            truncated: false,
          }),
          loadCredentials: async () => ({
            credentials: {
              type: "postgres" as const,
              host: "localhost",
              port: 5432,
              database: "app",
              username: "onequery",
              password: "secret",
              sslMode: "prefer" as const,
            },
            kind: "credentials_loaded" as const,
            source: postgresSource,
          }),
          executeSql: async () => ({
            elapsedMs: 12,
            kind: "succeeded" as const,
            rows: [{ answer: 42 }],
          }),
          persistUsage: async () => ({
            kind: "usage_persisted" as const,
            sourceId: "source-1",
          }),
        },
        observeEvent,
        observeEventFailure,
        org,
        requestId: "req-11",
        sourceName: "warehouse",
        sql: "select answer from stats",
        timeoutMs: undefined,
      })
    ).rejects.toThrow("query action trail unavailable");
    expect(observeEventFailure).toHaveBeenCalledTimes(1);
    expect(
      observeEventFailure.mock.calls.map(([input]) => input.event.type)
    ).toEqual(["source_loaded"]);
  });

  it("returns a ready validation plan without loading credentials", async () => {
    const loadSource = vi.fn(async () => ({
      kind: "found" as const,
      source: postgresSource,
    }));
    const validateQuery = vi.fn(async () => ({
      kind: "query_ready" as const,
      normalizedSql: "SELECT answer FROM stats LIMIT 1000",
      truncated: true,
    }));

    expect(
      await runCliQueryValidationWorkflow({
        dispatch: {
          loadSource,
          validateQuery,
        },
        org,
        requestId: "req-7",
        sourceName: "warehouse",
        sql: "select answer from stats",
        timeoutMs: 20_000,
      })
    ).toEqual({
      kind: "ready",
      normalizedSql: "SELECT answer FROM stats LIMIT 1000",
      requestId: "req-7",
      source: postgresSource,
      sourceName: "warehouse",
      timeoutMs: 20_000,
      truncated: true,
    });
  });

  it("returns validation rejections before credential loading", async () => {
    const loadSource = vi.fn(async () => ({
      kind: "found" as const,
      source: postgresSource,
    }));
    const validateQuery = vi.fn(async () => ({
      detail: "Only SELECT queries are allowed. Got: delete",
      kind: "query_rejected" as const,
    }));

    expect(
      await runCliQueryValidationWorkflow({
        dispatch: {
          loadSource,
          validateQuery,
        },
        org,
        requestId: "req-8",
        sourceName: "warehouse",
        sql: "delete from stats",
        timeoutMs: undefined,
      })
    ).toEqual({
      detail: "Only SELECT queries are allowed. Got: delete",
      kind: "query_rejected",
      requestId: "req-8",
    });
  });

  it("emits validation workflow transition events in order", async () => {
    const observeEvent = vi.fn();

    await runCliQueryValidationWorkflow({
      dispatch: {
        loadSource: async () => ({
          kind: "found" as const,
          source: postgresSource,
        }),
        validateQuery: async () => ({
          kind: "query_ready" as const,
          normalizedSql: "SELECT answer FROM stats LIMIT 1000",
          truncated: true,
        }),
      },
      observeEvent,
      org,
      requestId: "req-10",
      sourceName: "warehouse",
      sql: "select answer from stats",
      timeoutMs: undefined,
    });

    expect(observeEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        actionType: "validate",
        requestId: "req-10",
        source: postgresSource,
        sourceKey: "warehouse",
        type: "source_loaded",
      },
      {
        actionType: "validate",
        normalizedSql: "SELECT answer FROM stats LIMIT 1000",
        normalizedSqlChanged: true,
        requestId: "req-10",
        source: postgresSource,
        sourceKey: "warehouse",
        type: "query_validated",
      },
    ]);
  });

  it("fails closed when validation trail writes fail", async () => {
    const observeEvent = vi.fn(async () => {
      throw new Error("query action trail unavailable");
    });
    const observeEventFailure = vi.fn();

    await expect(
      runCliQueryValidationWorkflow({
        dispatch: {
          loadSource: async () => ({
            kind: "found" as const,
            source: postgresSource,
          }),
          validateQuery: async () => ({
            kind: "query_ready" as const,
            normalizedSql: "SELECT answer FROM stats LIMIT 1000",
            truncated: false,
          }),
        },
        observeEvent,
        observeEventFailure,
        org,
        requestId: "req-12",
        sourceName: "warehouse",
        sql: "select answer from stats",
        timeoutMs: undefined,
      })
    ).rejects.toThrow("query action trail unavailable");
    expect(observeEventFailure).toHaveBeenCalledTimes(1);
    expect(
      observeEventFailure.mock.calls.map(([input]) => input.event.type)
    ).toEqual(["source_loaded"]);
  });
});
