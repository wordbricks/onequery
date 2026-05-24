import type {
  Connection as SnowflakeConnection,
  ConnectionOptions as SnowflakeConnectionOptions,
  RowStatement as SnowflakeRowStatement,
  StatementOption as SnowflakeStatementOption,
} from "snowflake-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeBigQueryQuery,
  executeCloudflareD1Query,
  executeDatabaseQuery,
  executeMotherDuckQuery,
  executeSnowflakeQuery,
  executeValidatedDatabaseQuery,
  executeLaminarQuery,
  executePostgresQuery,
} from "./execute-query";
import type { DatabaseQueryResult } from "./execute-query";
import type { PostgresClientConfig } from "./postgres-transport";

const originalFetch = globalThis.fetch;
const postgresCredentials = {
  database: "app",
  host: "db.example.com",
  password: "secret",
  port: 5432,
  username: "app",
} as const;
const snowflakeCredentials = {
  account: "xy12345.us-east-1",
  database: "analytics",
  password: "secret",
  type: "snowflake",
  username: "app",
  warehouse: "compute_wh",
} as const;

type PostgresPlan = {
  connectError?: Error;
  rows?: Record<string, unknown>[];
};

function createPostgresRunner(plans: PostgresPlan[]) {
  const receivedConfigs: PostgresClientConfig[] = [];

  return {
    receivedConfigs,
    runner: async (
      config: PostgresClientConfig,
      _query: string
    ): Promise<Record<string, unknown>[]> => {
      receivedConfigs.push(config);
      const plan = plans.shift() ?? { rows: [{ result: 1 }] };

      if (plan.connectError) {
        throw plan.connectError;
      }

      return plan.rows ?? [{ result: 1 }];
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function expectPreflightFailure(
  invoke: () => Promise<DatabaseQueryResult<unknown>>,
  message: string
) {
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const result = await invoke();
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.message).toContain(message);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
}

function unwrapQueryResult<T>(result: DatabaseQueryResult<T>): T {
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

describe("data source query execution", () => {
  it.each([
    [
      "non-read-only SQL",
      () =>
        executeDatabaseQuery({
          credentials: {
            ...postgresCredentials,
            host: "localhost",
            sslMode: "prefer",
            type: "postgres",
          },
          sql: "DELETE FROM users",
        }),
      "Only SELECT queries are allowed.",
    ],
    [
      "invalid BigQuery locations",
      () =>
        executeBigQueryQuery(
          {
            accessToken: "bq-access-token",
            authType: "oauth",
            expiresAt: Date.now() + 60_000,
            projectId: "project-123",
            refreshToken: "bq-refresh-token",
            type: "bigquery",
          },
          "SELECT 1",
          {
            location: "us-central1?debug=true",
          }
        ),
      "BigQuery location is invalid",
    ],
    [
      "Laminar base URLs with paths",
      () =>
        executeLaminarQuery(
          {
            apiBaseUrl: "https://api.lmnr.ai/custom-path",
            apiKey: "laminar-api-key",
            type: "laminar",
          },
          "SELECT 1"
        ),
      "Laminar API base URL must not include a path",
    ],
  ])(
    "returns %s failures before attempting execution",
    async (_label, invoke, message) => {
      await expectPreflightFailure(invoke, message);
    }
  );

  it("executes validated SQL without repeating SQL validation", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
      json: async () => ({ data: [{ ok: true }] }),
      ok: true,
      status: 200,
      text: async () => "",
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const rows = unwrapQueryResult(
      await executeValidatedDatabaseQuery({
        credentials: {
          apiKey: "laminar-api-key",
          type: "laminar",
        },
        // This trusted API is only for callers that already validated SQL.
        normalizedSql: "DELETE FROM users",
      })
    );

    expect(rows).toEqual([{ ok: true }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).toEqual({
      query: "DELETE FROM users",
    });
  });

  it("executes Cloudflare D1 queries through the D1 REST API", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
      json: async () => ({
        errors: [],
        messages: [],
        result: [
          {
            meta: {},
            results: [{ one: 1 }],
            success: true,
          },
        ],
        success: true,
      }),
      ok: true,
      status: 200,
      text: async () => "",
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const rows = unwrapQueryResult(
      await executeCloudflareD1Query(
        {
          accountId: "acct_123",
          apiToken: "cf-token",
          databaseId: "db_123",
          type: "cloudflare_d1",
        },
        "SELECT 1"
      )
    );

    expect(rows).toEqual([{ one: 1 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct_123/d1/database/db_123/query"
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer cf-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init?.body as string)).toEqual({ sql: "SELECT 1" });
  });

  it("sanitizes Cloudflare D1 error text", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
      json: async () => ({}),
      ok: false,
      status: 403,
      text: async () => "Bearer cf-token cannot access cf-token",
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await executeCloudflareD1Query(
      {
        accountId: "acct_123",
        apiToken: "cf-token",
        databaseId: "db_123",
        type: "cloudflare_d1",
      },
      "SELECT 1"
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe(
        "Cloudflare D1 query failed: 403 Bearer [REDACTED] cannot access ***"
      );
    }
  });

  it("executes Snowflake queries with the created connection", async () => {
    const statement = {
      cancel: vi.fn(),
    } as unknown as SnowflakeRowStatement;
    const connection = {
      connectAsync: vi.fn(
        async () => undefined as unknown as SnowflakeConnection
      ),
      destroy: vi.fn((callback: () => void) => {
        callback();
      }),
      execute: vi.fn((options: SnowflakeStatementOption) => {
        options.complete?.(undefined, statement, [{ one: 1 }]);
        return statement;
      }),
    } as unknown as SnowflakeConnection;
    const createConnection = vi.fn(
      (_options: SnowflakeConnectionOptions) => connection
    );

    const rows = unwrapQueryResult(
      await executeSnowflakeQuery(snowflakeCredentials, "SELECT 1", 1000, {
        createConnection,
      })
    );

    expect(rows).toEqual([{ one: 1 }]);
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        account: snowflakeCredentials.account,
        application: "OneQuery",
        database: snowflakeCredentials.database,
        timeout: 1000,
        username: snowflakeCredentials.username,
        warehouse: snowflakeCredentials.warehouse,
      })
    );
    expect(connection.connectAsync).toHaveBeenCalledTimes(1);
    expect(connection.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        rowMode: "object_with_renamed_duplicated_columns",
        sqlText: "SELECT 1",
      })
    );
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it("uses TLS without certificate verification for postgres sslmode=require", async () => {
    const { receivedConfigs, runner } = createPostgresRunner([]);

    const rows = unwrapQueryResult(
      await executePostgresQuery(
        {
          ...postgresCredentials,
          sslMode: "require",
          type: "postgres",
        },
        "SELECT 1",
        undefined,
        runner
      )
    );

    expect(rows).toEqual([{ result: 1 }]);
    expect(receivedConfigs).toHaveLength(1);
    expect(receivedConfigs[0]).toMatchObject({
      options: expect.stringContaining("default_transaction_read_only=on"),
      ssl: { rejectUnauthorized: false },
    });
  });

  it("executes MotherDuck queries through the Postgres wire endpoint", async () => {
    const receivedConfigs: unknown[] = [];
    const rows = unwrapQueryResult(
      await executeMotherDuckQuery(
        {
          database: "md:analytics",
          host: "pg.us-east-1-aws.motherduck.com",
          port: 5432,
          token: "md-token",
          type: "motherduck",
          username: "postgres",
        },
        "SELECT 1",
        12_000,
        async (config, query) => {
          receivedConfigs.push({ config, query });
          return [{ result: 1 }];
        }
      )
    );

    expect(rows).toEqual([{ result: 1 }]);
    expect(receivedConfigs).toEqual([
      {
        config: {
          connectionTimeoutMillis: 12_000,
          database: "md:analytics",
          host: "pg.us-east-1-aws.motherduck.com",
          password: "md-token",
          port: 5432,
          query_timeout: 12_000,
          ssl: { rejectUnauthorized: true },
          user: "postgres",
        },
        query: "SELECT 1",
      },
    ]);
  });

  it("relaxes certificate verification before retrying postgres sslmode=prefer", async () => {
    const { receivedConfigs, runner } = createPostgresRunner([
      {
        connectError: new Error("self signed certificate in certificate chain"),
      },
      {
        rows: [{ result: 1 }],
      },
    ]);

    const rows = unwrapQueryResult(
      await executePostgresQuery(
        {
          ...postgresCredentials,
          sslMode: "prefer",
          type: "postgres",
        },
        "SELECT 1",
        undefined,
        runner
      )
    );

    expect(rows).toEqual([{ result: 1 }]);
    expect(receivedConfigs).toHaveLength(2);
    expect(receivedConfigs[0]).toMatchObject({
      ssl: { rejectUnauthorized: true },
    });
    expect(receivedConfigs[1]).toMatchObject({
      ssl: { rejectUnauthorized: false },
    });
  });

  it("preserves the prior transport error when plaintext fallback also fails", async () => {
    const initialError = new Error("connection reset by peer");
    const { receivedConfigs, runner } = createPostgresRunner([
      {
        connectError: initialError,
      },
      {
        connectError: new Error("no pg_hba.conf entry"),
      },
    ]);

    const result = await executePostgresQuery(
      {
        ...postgresCredentials,
        sslMode: "prefer",
        type: "postgres",
      },
      "SELECT 1",
      undefined,
      runner
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe(initialError.message);
    }

    expect(receivedConfigs).toHaveLength(2);
    expect(receivedConfigs[0]).toMatchObject({
      ssl: { rejectUnauthorized: true },
    });
    expect(receivedConfigs[1]).toMatchObject({
      ssl: false,
    });
  });
});
