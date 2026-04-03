import type { MySQLCredentials } from "@onequery/db/server";
import mysql from "mysql2/promise";

import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

export type ConnectionTestResult = {
  success: boolean;
  message: string;
  error?: string;
  latencyMs?: number;
};

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
  useSsl = shouldUseSsl("prefer")
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

type ConnectionAttemptResult = { ok: true } | { ok: false; error: unknown };

const attemptMySQLConnection = async (
  credentials: MySQLCredentials,
  timeoutSeconds: number,
  useSsl: boolean
): Promise<ConnectionAttemptResult> => {
  try {
    const connection = await mysql.createConnection(
      buildMySQLConnectionConfig(credentials, timeoutSeconds, useSsl)
    );

    try {
      await connection.execute("SELECT 1 as result");
      return { ok: true };
    } catch (error: unknown) {
      return { error, ok: false };
    } finally {
      await connection.end().catch(() => {});
    }
  } catch (error: unknown) {
    return { error, ok: false };
  }
};

export async function testMySQLConnection(
  credentials: MySQLCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const initialUseSsl = shouldUseSsl("prefer");
  const initialAttempt = attemptMySQLConnection(
    credentials,
    timeoutSeconds,
    initialUseSsl
  );
  const finalAttempt = shouldFallbackToPlaintext("prefer")
    ? initialAttempt.then(async (result) => {
        if (result.ok) {
          return result;
        }
        const fallbackResult = await attemptMySQLConnection(
          credentials,
          timeoutSeconds,
          false
        );
        return fallbackResult.ok ? fallbackResult : result;
      })
    : initialAttempt;

  return finalAttempt.then((result) => {
    const latencyMs = Date.now() - startTime;
    if (result.ok) {
      return {
        latencyMs,
        message: `Connection successful (${latencyMs}ms)`,
        success: true,
      };
    }
    const errorMessage =
      result.error instanceof Error
        ? result.error.message
        : String(result.error);
    return {
      error: sanitizeErrorMessage(errorMessage),
      latencyMs,
      message: "Connection failed",
      success: false,
    };
  });
}

function sanitizeErrorMessage(message: string): string {
  return message.replaceAll(/password[=:]\s*\S+/gi, "password=***");
}
