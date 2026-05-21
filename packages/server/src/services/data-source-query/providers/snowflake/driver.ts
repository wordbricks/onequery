import type { SnowflakeCredentials } from "@onequery/db/server";

import { runProviderConnectionTest } from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "../../core/timeout";
import type { QueryDeadline } from "../../core/timeout";
import type { ValidatedSql } from "../../core/types";
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
): Promise<Record<string, unknown>[]> {
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
}): Promise<Record<string, unknown>[]> {
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
    await session.close();
  }
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
  execute: async ({ credentials, deadline, sql }) => ({
    rows: await executeSnowflakeQueryWithTransport({
      credentials,
      deadline,
      sql,
      transport: createSnowflakeTransport(),
    }),
  }),
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
    execute: async () =>
      executeSnowflakeQueryWithTransport({
        credentials,
        deadline,
        sql: CONNECTION_TEST_QUERY as ValidatedSql,
        transport: createSnowflakeTransport(),
      }),
    sanitizeError: sanitizeSnowflakeErrorMessage,
  });
}
