import type { MySQLCredentials } from "@onequery/db/server";
import { Result } from "better-result";
import mysql from "mysql2/promise";

import {
  createFailedConnectionTest,
  createSuccessfulConnectionTest,
} from "./connection-test-outcome";
import type { ConnectionTestOutcome } from "./connection-test-outcome";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

export type MySQLConnectionConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: { rejectUnauthorized: boolean };
  connectTimeout: number;
};

type SslMode = MySQLCredentials["sslMode"];

const shouldUseSsl = (sslMode: SslMode): boolean => sslMode !== "disable";

const shouldFallbackToPlaintext = (sslMode: SslMode): boolean =>
  sslMode === "prefer";

export function buildMySQLConnectionConfig(
  credentials: MySQLCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS,
  useSsl = shouldUseSsl(credentials.sslMode)
): MySQLConnectionConfig {
  const { host, port, database, username, password } = credentials;

  const config: MySQLConnectionConfig = {
    connectTimeout: timeoutSeconds * 1000,
    database,
    host,
    password,
    port,
    user: username, // Convert to milliseconds
  };

  if (useSsl) {
    config.ssl = { rejectUnauthorized: true };
  }

  return config;
}

const attemptMySQLConnection = async (
  credentials: MySQLCredentials,
  timeoutSeconds: number,
  useSsl: boolean
): Promise<Result<void, unknown>> =>
  Result.tryPromise(async () => {
    const connection = await mysql.createConnection(
      buildMySQLConnectionConfig(credentials, timeoutSeconds, useSsl)
    );

    try {
      await connection.execute("SELECT 1 as result");
    } finally {
      await connection.end().catch(() => {});
    }
  });

export async function testMySQLConnection(
  credentials: MySQLCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestOutcome> {
  const startTime = Date.now();
  const initialUseSsl = shouldUseSsl(credentials.sslMode);
  const initialAttempt = attemptMySQLConnection(
    credentials,
    timeoutSeconds,
    initialUseSsl
  );
  const finalAttempt = shouldFallbackToPlaintext(credentials.sslMode)
    ? initialAttempt.then(async (result) => {
        if (result.isOk()) {
          return result;
        }
        const fallbackResult = await attemptMySQLConnection(
          credentials,
          timeoutSeconds,
          false
        );
        return fallbackResult.isOk() ? fallbackResult : result;
      })
    : initialAttempt;

  return finalAttempt.then((result) => {
    const latencyMs = Date.now() - startTime;
    if (result.isOk()) {
      return Result.ok(createSuccessfulConnectionTest(latencyMs));
    }
    const errorMessage =
      result.error instanceof Error
        ? result.error.message
        : String(result.error);
    return Result.err(
      createFailedConnectionTest({
        detail: sanitizeErrorMessage(errorMessage),
        latencyMs,
      })
    );
  });
}

function sanitizeErrorMessage(message: string): string {
  return message.replaceAll(/password[=:]\s*\S+/gi, "password=***");
}
