import type { PostgresCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { runProviderConnectionTest } from "../../core/connection-test";
import type { ProviderQueryDriver } from "../../core/driver";
import { toQueryFailure } from "../../core/errors";
import { normalizeRecordRows } from "../../core/rows";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "../../core/timeout";
import type { QueryDeadline as Deadline } from "../../core/timeout";
import type { DatabaseQueryResult } from "../../core/types";
import { validateReadOnlySql } from "../../core/validation";
import {
  buildPostgresClientConfig,
  resolveInitialPostgresTransportState,
  resolvePostgresFailureTransitions,
} from "../../postgres-transport";
import type { PostgresClientConfig } from "../../postgres-transport";
import { classifyPostgresError, sanitizePostgresErrorMessage } from "./errors";

const CONNECTION_TEST_QUERY = "SELECT 1 as result";

export type PostgresQueryRunner = (
  config: PostgresClientConfig,
  query: string
) => Promise<Record<string, unknown>[]>;

async function runPostgresQuery(
  pg: typeof import("pg"),
  config: PostgresClientConfig,
  query: string
): Promise<Record<string, unknown>[]> {
  const client = new pg.Client(config);
  await client.connect();

  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(query);
    await client.query("COMMIT");
    return normalizeRecordRows("PostgreSQL", result.rows);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    // Decision: row delivery and the original provider error are the primary
    // outcome; cleanup failures are secondary operational signals and must not
    // mask a successful query or the original failure.
    await client.end().catch((cleanupError: unknown) => {
      console.warn("[query-database] PostgreSQL cleanup failed", {
        error:
          cleanupError instanceof Error ? cleanupError.message : cleanupError,
      });
    });
  }
}

async function resolvePostgresQueryRunner(): Promise<PostgresQueryRunner> {
  const pg = await import("pg");
  return (config, query) => runPostgresQuery(pg, config, query);
}

export async function executePostgresQuery(
  creds: PostgresCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS,
  runner?: PostgresQueryRunner
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  return Result.tryPromise({
    try: () => executePostgresQueryUnsafe(creds, query, timeoutMs, runner),
    catch: (error) =>
      toQueryFailure({
        classifier: classifyPostgresError,
        error,
        provider: "postgres",
      }),
  });
}

async function executePostgresQueryUnsafe(
  creds: PostgresCredentials,
  query: string,
  timeoutMs: number,
  runner?: PostgresQueryRunner
): Promise<Record<string, unknown>[]> {
  const queryRunner = runner ?? (await resolvePostgresQueryRunner());
  const initialState = resolveInitialPostgresTransportState(creds.sslMode);

  try {
    return await queryRunner(
      buildPostgresClientConfig(creds, initialState, timeoutMs),
      query
    );
  } catch (initialError) {
    let priorError = initialError;

    for (const transition of resolvePostgresFailureTransitions(
      creds.sslMode,
      initialError
    )) {
      try {
        return await queryRunner(
          buildPostgresClientConfig(creds, transition.nextState, timeoutMs),
          query
        );
      } catch (transitionError) {
        if (transition.preservePriorErrorOnFailure) {
          throw priorError;
        }

        priorError = transitionError;
      }
    }

    throw priorError;
  }
}

export const postgresQueryDriver = {
  provider: "postgres",
  capabilities: {
    cancellation: "none",
    connectionTest: true,
    dryRun: false,
    stats: false,
  },
  validateSql: async ({ sql }) =>
    validateReadOnlySql({
      provider: "postgres",
      sql,
    }),
  execute: async ({ credentials, deadline, sql }) =>
    (await executePostgresQuery(credentials, sql, deadline.timeoutMs)).map(
      (rows) => ({ rows })
    ),
  classifyError: classifyPostgresError,
  testConnection: async ({ credentials, deadline }) =>
    runPostgresConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<PostgresCredentials>;

export async function runPostgresConnectionTest(
  credentials: PostgresCredentials,
  deadline: Deadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  return runProviderConnectionTest({
    deadline,
    execute: () =>
      executePostgresQuery(
        credentials,
        CONNECTION_TEST_QUERY,
        deadline.timeoutMs
      ),
    sanitizeError: sanitizePostgresErrorMessage,
  });
}
