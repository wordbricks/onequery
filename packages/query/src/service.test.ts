import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import type { ProviderRegistry, SqlValidator } from "./driver";
import { createQueryService } from "./service";
import { createPreparedReadOnlyQuery } from "./types";
import type { ValidatedSql } from "./types";

const validator = {
  validateReadOnlySql: async (input) =>
    Result.ok(
      createPreparedReadOnlyQuery({
        normalizedSql: input.sql.trim(),
        provider: input.provider,
      })
    ),
} satisfies SqlValidator;

function createRegistry(): ProviderRegistry {
  const postgresDriver = {
    provider: "postgres",
    capabilities: {
      cancellation: "none",
      connectionTest: false,
      dryRun: false,
      stats: false,
    },
    execute: async (input: {
      credentials: { type: string };
      sql: ValidatedSql;
    }) =>
      Result.ok({
        rows: [
          {
            provider: input.credentials.type,
            sql: input.sql,
          },
        ],
      }),
    testConnection: async () =>
      Result.err({
        _tag: "UnsupportedDataSourceTestError",
        message: "not implemented",
        reason: "not_implemented",
      }),
  } as const;

  return {
    aws_athena_connector: postgresDriver,
    bigquery: postgresDriver,
    cloudflare_d1: postgresDriver,
    laminar: postgresDriver,
    motherduck: postgresDriver,
    mysql: postgresDriver,
    postgres: postgresDriver,
    snowflake: postgresDriver,
  } as unknown as ProviderRegistry;
}

describe("createQueryService", () => {
  it("validates with an injected SQL validator before execution", async () => {
    const service = createQueryService({
      registry: createRegistry(),
      validator,
    });

    const result = await service.executeDatabaseQuery({
      credentials: {
        database: "postgres",
        host: "localhost",
        password: "secret",
        port: 5432,
        sslMode: "disable",
        type: "postgres",
        username: "onequery",
      },
      sql: " select 1 ",
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual([
      {
        provider: "postgres",
        sql: "select 1" as ValidatedSql,
      },
    ]);
  });
});
