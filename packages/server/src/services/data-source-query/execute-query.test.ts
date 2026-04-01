import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeBigQueryQuery,
  executeDatabaseQuery,
  executeLaminarQuery,
  executePostgresQuery,
} from "./execute-query";
import type { PostgresClientConfig } from "./postgres-transport";

const originalFetch = globalThis.fetch;

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

describe("data source query execution", () => {
  it("rejects non-read-only SQL before attempting execution", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      executeDatabaseQuery({
        credentials: {
          database: "app",
          host: "localhost",
          password: "secret",
          port: 5432,
          sslMode: "prefer",
          type: "postgres",
          username: "app",
        },
        sql: "DELETE FROM users",
      })
    ).rejects.toThrowError("Only SELECT queries are allowed.");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid BigQuery locations before making a request", async () => {
    await expect(
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
      )
    ).rejects.toThrowError("BigQuery location is invalid");
  });

  it("rejects Laminar base URLs with paths before making a request", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      executeLaminarQuery(
        {
          apiBaseUrl: "https://api.lmnr.ai/custom-path",
          apiKey: "laminar-api-key",
          type: "laminar",
        },
        "SELECT 1"
      )
    ).rejects.toThrowError("Laminar API base URL must not include a path");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses TLS without certificate verification for postgres sslmode=require", async () => {
    const { receivedConfigs, runner } = createPostgresRunner([]);

    const rows = await executePostgresQuery(
      {
        database: "app",
        host: "db.example.com",
        password: "secret",
        port: 5432,
        sslMode: "require",
        type: "postgres",
        username: "app",
      },
      "SELECT 1",
      undefined,
      runner
    );

    expect(rows).toEqual([{ result: 1 }]);
    expect(receivedConfigs).toHaveLength(1);
    expect(receivedConfigs[0]).toMatchObject({
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
        database: "app",
        host: "db.example.com",
        password: "secret",
        port: 5432,
        sslMode: "prefer",
        type: "postgres",
        username: "app",
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
          database: "app",
          host: "db.example.com",
          password: "secret",
          port: 5432,
          sslMode: "prefer",
          type: "postgres",
          username: "app",
        },
        "SELECT 1",
        undefined,
        runner
      )
    ).rejects.toThrowError(initialError.message);

    expect(receivedConfigs).toHaveLength(2);
    expect(receivedConfigs[0]).toMatchObject({
      ssl: { rejectUnauthorized: true },
    });
    expect(receivedConfigs[1]).toMatchObject({
      ssl: false,
    });
  });
});
