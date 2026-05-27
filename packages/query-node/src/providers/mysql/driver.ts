import type { MySQLCredentials } from "@onequery/query";
import { runProviderConnectionTest } from "@onequery/query/connection-test";
import type { ProviderQueryDriver } from "@onequery/query/driver";
import { toQueryFailure } from "@onequery/query/errors";
import { normalizeRecordRows } from "@onequery/query/rows";
import { QUERY_TIMEOUT_MS, createQueryDeadline } from "@onequery/query/timeout";
import type { QueryDeadline } from "@onequery/query/timeout";
import type { DatabaseQueryResult } from "@onequery/query/types";
import { Result } from "better-result";

import { isTlsVerificationError } from "../../postgres-transport";
import { classifyMySQLError, sanitizeMySQLErrorMessage } from "./errors";

type MySQLSslConfig = { rejectUnauthorized: boolean } | undefined;
type NegotiatedSslMode = MySQLCredentials["sslMode"];

const CONNECTION_TEST_QUERY = "SELECT 1 as result";

function shouldUseSsl(sslMode: NegotiatedSslMode): boolean {
  return sslMode !== "disable";
}

function shouldFallbackToPlaintext(sslMode: NegotiatedSslMode): boolean {
  return sslMode === "prefer";
}

export type MySQLConnectionConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: { rejectUnauthorized: boolean };
  connectTimeout: number;
};

function buildMySQLConnectionConfig(
  creds: MySQLCredentials,
  ssl: MySQLSslConfig,
  timeoutMs: number
): MySQLConnectionConfig {
  return {
    connectTimeout: timeoutMs,
    database: creds.database,
    host: creds.host,
    password: creds.password,
    port: creds.port,
    ssl,
    user: creds.username,
  };
}

function buildMySQLSslConfig(
  useSsl: boolean,
  rejectUnauthorized: boolean
): MySQLSslConfig {
  return useSsl ? { rejectUnauthorized } : undefined;
}

async function runMySQLQuery(
  mysql: typeof import("mysql2/promise"),
  config: MySQLConnectionConfig,
  query: string,
  timeoutMs: number
): Promise<Record<string, unknown>[]> {
  const connection = await mysql.createConnection(config);

  try {
    await connection.execute("SET SESSION max_execution_time = ?", [timeoutMs]);
    await connection.query("START TRANSACTION READ ONLY");
    const result = await connection.execute(query);
    await connection.query("COMMIT");
    return normalizeRecordRows("MySQL", result[0]);
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    // Decision: row delivery and the original provider error are the primary
    // outcome; cleanup failures are secondary operational signals and must not
    // mask a successful query or the original failure.
    await connection.end().catch((cleanupError: unknown) => {
      console.warn("[query-database] MySQL cleanup failed", {
        error:
          cleanupError instanceof Error ? cleanupError.message : cleanupError,
      });
    });
  }
}

export async function executeMySQLQuery(
  creds: MySQLCredentials,
  query: string,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<DatabaseQueryResult<Record<string, unknown>[]>> {
  return Result.tryPromise({
    try: () => executeMySQLQueryUnsafe(creds, query, timeoutMs),
    catch: (error) =>
      toQueryFailure({
        classifier: classifyMySQLError,
        error,
        provider: "mysql",
      }),
  });
}

async function executeMySQLQueryUnsafe(
  creds: MySQLCredentials,
  query: string,
  timeoutMs: number
): Promise<Record<string, unknown>[]> {
  const mysql = await import("mysql2/promise");
  const sslMode = creds.sslMode;
  const initialUseSsl = shouldUseSsl(sslMode);
  const initialAttempt = runMySQLQuery(
    mysql,
    buildMySQLConnectionConfig(
      creds,
      buildMySQLSslConfig(initialUseSsl, true),
      timeoutMs
    ),
    query,
    timeoutMs
  );

  if (!shouldFallbackToPlaintext(sslMode)) {
    return initialAttempt;
  }

  const attemptPlaintext = async (error: unknown) => {
    try {
      return await runMySQLQuery(
        mysql,
        buildMySQLConnectionConfig(
          creds,
          buildMySQLSslConfig(false, false),
          timeoutMs
        ),
        query,
        timeoutMs
      );
    } catch {
      throw error;
    }
  };

  try {
    return await initialAttempt;
  } catch (error) {
    if (!isTlsVerificationError(error)) {
      return attemptPlaintext(error);
    }

    try {
      return await runMySQLQuery(
        mysql,
        buildMySQLConnectionConfig(
          creds,
          buildMySQLSslConfig(true, false),
          timeoutMs
        ),
        query,
        timeoutMs
      );
    } catch (relaxedError) {
      return attemptPlaintext(relaxedError);
    }
  }
}

export const mysqlQueryDriver = {
  provider: "mysql",
  capabilities: {
    cancellation: "none",
    connectionTest: true,
    dryRun: false,
    stats: false,
  },
  execute: async ({ credentials, deadline, sql }) =>
    (await executeMySQLQuery(credentials, sql, deadline.timeoutMs)).map(
      (rows) => ({ rows })
    ),
  classifyError: classifyMySQLError,
  testConnection: async ({ credentials, deadline }) =>
    runMySQLConnectionTest(credentials, deadline),
} satisfies ProviderQueryDriver<MySQLCredentials>;

export async function runMySQLConnectionTest(
  credentials: MySQLCredentials,
  deadline: QueryDeadline = createQueryDeadline(QUERY_TIMEOUT_MS)
) {
  return runProviderConnectionTest({
    deadline,
    execute: () =>
      executeMySQLQuery(credentials, CONNECTION_TEST_QUERY, deadline.timeoutMs),
    sanitizeError: sanitizeMySQLErrorMessage,
  });
}
