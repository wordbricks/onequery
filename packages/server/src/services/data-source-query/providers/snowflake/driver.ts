import type { SnowflakeCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { runProviderConnectionTest } from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import { toErrorMessage, toQueryFailure } from "../../core/errors";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "../../core/timeout";
import type { QueryDeadline } from "../../core/timeout";
import type { DatabaseQueryResult, ValidatedSql } from "../../core/types";
import { validateReadOnlySql } from "../../core/validation";
import { createSnowflakeTransport } from "./connection";
import type {
  SnowflakeQueryDependencies,
  SnowflakeTransport,
} from "./connection";
import {
  classifySnowflakeError,
  sanitizeSnowflakeErrorMessage,
} from "./errors";

const CONNECTION_TEST_QUERY = "SELECT 1 AS result";

export type { SnowflakeQueryDependencies } from "./connection";

export async function executeSnowflakeQuery(
  creds: SnowflakeCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS,
  dependencies?: SnowflakeQueryDependencies
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  return executeSnowflakeQueryWithTransport({
    credentials: creds,
    deadline: createQueryDeadline(timeoutMs),
    sql: query as ValidatedSql,
    transport: createSnowflakeTransport(dependencies),
  });
}

async function executeSnowflakeQueryWithTransport(input: {
  credentials: SnowflakeCredentials;
  deadline: QueryDeadline;
  sql: ValidatedSql;
  transport: SnowflakeTransport;
}): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  return Result.tryPromise({
    try: async () => {
      const session = await input.transport.open({
        credentials: input.credentials,
        deadline: input.deadline,
      });

      try {
        return await session.execute({
          deadline: input.deadline,
          sql: input.sql,
        });
      } finally {
        // Decision: row delivery and the original provider error are the
        // primary outcome; cleanup failures are secondary operational signals
        // and must not mask a successful query or the original failure.
        await session.close().catch((cleanupError: unknown) => {
          console.warn("[query-database] Snowflake cleanup failed", {
            error: toErrorMessage(cleanupError),
          });
        });
      }
    },
    catch: (error) =>
      toQueryFailure({
        classifier: classifySnowflakeError,
        error,
        provider: "snowflake",
      }),
  });
}

export const snowflakeQueryDriver = {
  provider: "snowflake",
  capabilities: {
    cancellation: "best_effort",
    connectionTest: true,
    dryRun: false,
    stats: false,
  },
  validateSql: async ({ sql }) =>
    validateReadOnlySql({
      provider: "snowflake",
      sql,
    }),
  execute: async ({ credentials, deadline, sql }) =>
    (
      await executeSnowflakeQueryWithTransport({
        credentials,
        deadline,
        sql,
        transport: createSnowflakeTransport(),
      })
    ).map((rows) => ({ rows })),
  classifyError: classifySnowflakeError,
  testConnection: async ({ credentials, deadline }) =>
    runSnowflakeConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<SnowflakeCredentials>;

export async function runSnowflakeConnectionTest(
  credentials: SnowflakeCredentials,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  return runProviderConnectionTest({
    deadline,
    execute: () =>
      executeSnowflakeQueryWithTransport({
        credentials,
        deadline,
        sql: CONNECTION_TEST_QUERY as ValidatedSql,
        transport: createSnowflakeTransport(),
      }),
    sanitizeError: sanitizeSnowflakeErrorMessage,
  });
}
