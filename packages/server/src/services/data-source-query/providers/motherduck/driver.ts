import type { MotherDuckCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { runProviderConnectionTest } from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import { toErrorMessage, toQueryFailure } from "../../core/errors";
import { normalizeRecordRows } from "../../core/rows";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "../../core/timeout";
import type { QueryDeadline } from "../../core/timeout";
import type { DatabaseQueryResult } from "../../core/types";
import { validateReadOnlySql } from "../../core/validation";
import {
  classifyMotherDuckError,
  sanitizeMotherDuckErrorMessage,
} from "./errors";

const CONNECTION_TEST_QUERY = "SELECT 1 AS onequery_connection_test";

export type MotherDuckClientConfig = {
  connectionTimeoutMillis: number;
  database: string;
  host: string;
  password: string;
  port: number;
  query_timeout: number;
  ssl: { rejectUnauthorized: true };
  user: string;
};

export type MotherDuckQueryRunner = (
  config: MotherDuckClientConfig,
  query: string
) => Promise<Record<string, unknown>[]>;

async function runMotherDuckQuery(
  pg: typeof import("pg"),
  config: MotherDuckClientConfig,
  query: string
): Promise<Record<string, unknown>[]> {
  const client = new pg.Client(config);
  await client.connect();

  try {
    const result = await client.query(query);
    return normalizeRecordRows("MotherDuck", result.rows);
  } finally {
    await client.end().catch((cleanupError: unknown) => {
      console.warn("[query-database] MotherDuck cleanup failed", {
        error: toErrorMessage(cleanupError),
      });
    });
  }
}

async function resolveMotherDuckQueryRunner(): Promise<MotherDuckQueryRunner> {
  const pg = await import("pg");
  return (config, query) => runMotherDuckQuery(pg, config, query);
}

function buildMotherDuckClientConfig(
  creds: MotherDuckCredentials,
  timeoutMs: number
): MotherDuckClientConfig {
  return {
    connectionTimeoutMillis: timeoutMs,
    database: creds.database,
    host: creds.host,
    password: creds.token,
    port: creds.port,
    query_timeout: timeoutMs,
    ssl: { rejectUnauthorized: true },
    user: creds.username,
  };
}

export async function executeMotherDuckQuery(
  creds: MotherDuckCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS,
  runner?: MotherDuckQueryRunner
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  return Result.tryPromise({
    try: async () => {
      const queryRunner = runner ?? (await resolveMotherDuckQueryRunner());
      return queryRunner(buildMotherDuckClientConfig(creds, timeoutMs), query);
    },
    catch: (error) =>
      toQueryFailure({
        classifier: classifyMotherDuckError,
        error,
        provider: "motherduck",
      }),
  });
}

export const motherDuckQueryDriver = {
  provider: "motherduck",
  capabilities: {
    cancellation: "none",
    connectionTest: true,
    dryRun: false,
    stats: false,
  },
  validateSql: async ({ sql }) =>
    validateReadOnlySql({
      provider: "motherduck",
      sql,
    }),
  execute: async ({ credentials, deadline, sql }) =>
    (await executeMotherDuckQuery(credentials, sql, deadline.timeoutMs)).map(
      (rows) => ({ rows })
    ),
  classifyError: classifyMotherDuckError,
  testConnection: async ({ credentials, deadline }) =>
    runMotherDuckConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<MotherDuckCredentials>;

export async function runMotherDuckConnectionTest(
  credentials: MotherDuckCredentials,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  return runProviderConnectionTest({
    deadline,
    execute: () =>
      executeMotherDuckQuery(
        credentials,
        CONNECTION_TEST_QUERY,
        deadline.timeoutMs
      ),
    sanitizeError: sanitizeMotherDuckErrorMessage,
  });
}
