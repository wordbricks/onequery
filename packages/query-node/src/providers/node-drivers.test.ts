import type { Result as ResultType } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryNodeRuntime } from "../index";
import type { PostgresClientConfig } from "../postgres-transport";
import { executeMotherDuckQuery } from "./motherduck/driver";
import { executePostgresQuery } from "./postgres/driver";

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

function unwrapQueryResult<T>(result: ResultType<T, unknown>): T {
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Node query drivers", () => {
  it("returns non-read-only SQL failures before attempting execution", async () => {
    const runtime = createQueryNodeRuntime();
    const result = await runtime.service.executeDatabaseQuery({
      credentials: {
        ...postgresCredentials,
        host: "localhost",
        sslMode: "prefer",
        type: "postgres",
      },
      sql: "DELETE FROM users",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        "Only SELECT queries are allowed."
      );
    }
  });

  it("executes validated SQL without repeating SQL validation", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
      json: async () => ({ data: [{ ok: true }] }),
      ok: true,
      status: 200,
      text: async () => "",
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const runtime = createQueryNodeRuntime();
    const execution = unwrapQueryResult(
      await runtime.service.executeValidatedDatabaseQueryWithStats({
        credentials: {
          apiKey: "laminar-api-key",
          type: "laminar",
        },
        normalizedSql: "DELETE FROM users",
      })
    );

    expect(execution.rows).toEqual([{ ok: true }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).toEqual({
      query: "DELETE FROM users",
    });
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

  it("detects postgres TLS verification errors by Node error code", async () => {
    const { receivedConfigs, runner } = createPostgresRunner([
      {
        connectError: Object.assign(new Error("certificate rejected"), {
          code: "SELF_SIGNED_CERT_IN_CHAIN",
        }),
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
