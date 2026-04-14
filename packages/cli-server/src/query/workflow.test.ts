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
    ).toMatchSnapshot();
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
    ).toMatchSnapshot();
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

    expect({
      loadCredentials: finishCliQueryValidation({
        state: next,
        validation: {
          kind: "query_ready",
          normalizedSql: "SELECT * FROM stats LIMIT 1000",
          truncated: true,
        },
      }),
      validateQuery: next,
    }).toMatchSnapshot();
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
    ).toMatchSnapshot();
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
    ).toMatchSnapshot();
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
    ).toMatchSnapshot();
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

    expect(observeEvent.mock.calls.map(([event]) => event)).toMatchSnapshot();
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
    ).resolves.toMatchObject({
      detail: "query workflow event observation failed",
      kind: "query_preparation_failed",
      requestId: "req-11",
    });
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
    ).toMatchSnapshot();
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
    ).toMatchSnapshot();
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

    expect(observeEvent.mock.calls.map(([event]) => event)).toMatchSnapshot();
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
    ).resolves.toMatchObject({
      detail: "query workflow event observation failed",
      kind: "query_preparation_failed",
      requestId: "req-12",
    });
    expect(observeEventFailure).toHaveBeenCalledTimes(1);
    expect(
      observeEventFailure.mock.calls.map(([input]) => input.event.type)
    ).toEqual(["source_loaded"]);
  });
});
