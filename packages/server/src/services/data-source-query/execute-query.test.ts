import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeBigQueryQuery,
  executeDatabaseQuery,
  executeValidatedDatabaseQuery,
  executeLaminarQuery,
  executePostgresQuery,
} from "./execute-query";
import type { PostgresClientConfig } from "./postgres-transport";

const originalFetch = globalThis.fetch;
const postgresCredentials = {
  database: "app",
  host: "db.example.com",
  password: "secret",
  port: 5432,
  username: "app",
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

async function expectPreflightRejection(
  invoke: () => Promise<unknown>,
  message: string
) {
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  await expect(invoke()).rejects.toThrow(message);
  expect(fetchSpy).not.toHaveBeenCalled();
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
    "rejects %s before attempting execution",
    async (_label, invoke, message) => {
      await expectPreflightRejection(invoke, message);
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

    const rows = await executeValidatedDatabaseQuery({
      credentials: {
        apiKey: "laminar-api-key",
        type: "laminar",
      },
      // This trusted API is only for callers that already validated SQL.
      normalizedSql: "DELETE FROM users",
    });

    expect(rows).toEqual([{ ok: true }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).toEqual({
      query: "DELETE FROM users",
    });
  });

  it("uses TLS without certificate verification for postgres sslmode=require", async () => {
    const { receivedConfigs, runner } = createPostgresRunner([]);

    const rows = await executePostgresQuery(
      {
        ...postgresCredentials,
        sslMode: "require",
        type: "postgres",
      },
      "SELECT 1",
      undefined,
      runner
    );

    expect(rows).toEqual([{ result: 1 }]);
    expect(receivedConfigs).toHaveLength(1);
    expect(receivedConfigs[0]).toMatchObject({
      options: expect.stringContaining("default_transaction_read_only=on"),
      ssl: { rejectUnauthorized: false },
    });
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

    const rows = await executePostgresQuery(
      {
        ...postgresCredentials,
        sslMode: "prefer",
        type: "postgres",
      },
      "SELECT 1",
      undefined,
      runner
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

    await expect(
      executePostgresQuery(
        {
          ...postgresCredentials,
          sslMode: "prefer",
          type: "postgres",
        },
        "SELECT 1",
        undefined,
        runner
      )
    ).rejects.toThrow(initialError.message);

    expect(receivedConfigs).toHaveLength(2);
    expect(receivedConfigs[0]).toMatchObject({
      ssl: { rejectUnauthorized: true },
    });
    expect(receivedConfigs[1]).toMatchObject({
      ssl: false,
    });
  });
});
