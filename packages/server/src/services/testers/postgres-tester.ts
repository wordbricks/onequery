import type { PostgresCredentials } from "@onequery/db/server";

import { executePostgresQuery } from "../data-source-query/execute-query";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

export type ConnectionTestResult = {
  success: boolean;
  message: string;
  error?: string;
  latencyMs?: number;
};

const CONNECTION_TEST_QUERY = "SELECT 1 as result";

export function buildPostgresConnectionString(
  credentials: PostgresCredentials
): string {
  const { host, port, database, username, password } = credentials;

  const encodedUsername = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password);
  const baseUrl = `postgres://${encodedUsername}:${encodedPassword}@${host}:${port}/${database}`;

  return `${baseUrl}?sslmode=prefer`;
}

export async function testPostgresConnection(
  credentials: PostgresCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    // Comment: Reuse the same `pg`-based execution path as runtime queries.
    await executePostgresQuery(
      credentials,
      CONNECTION_TEST_QUERY,
      timeoutSeconds * 1000
    );

    const latencyMs = Date.now() - startTime;

    return {
      latencyMs,
      message: `Connection successful (${latencyMs}ms)`,
      success: true,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      error: sanitizeErrorMessage(errorMessage),
      latencyMs,
      message: "Connection failed",
      success: false,
    };
  }
}

function sanitizeErrorMessage(message: string): string {
  return message.replaceAll(/password[=:]\s*\S+/gi, "password=***");
}
