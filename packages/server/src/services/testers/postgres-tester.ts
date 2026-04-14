import type { PostgresCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { executePostgresQuery } from "../data-source-query/execute-query";
import {
  createFailedConnectionTest,
  createSuccessfulConnectionTest,
} from "./connection-test-outcome";
import type { ConnectionTestOutcome } from "./connection-test-outcome";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

const CONNECTION_TEST_QUERY = "SELECT 1 as result";

export async function testPostgresConnection(
  credentials: PostgresCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestOutcome> {
  const startTime = Date.now();
  const outcome = await Result.tryPromise(async () =>
    // Comment: Reuse the same `pg`-based execution path as runtime queries.
    executePostgresQuery(
      credentials,
      CONNECTION_TEST_QUERY,
      timeoutSeconds * 1000
    )
  );
  const latencyMs = Date.now() - startTime;

  if (outcome.isOk()) {
    return Result.ok(createSuccessfulConnectionTest(latencyMs));
  }

  return Result.err(
    createFailedConnectionTest({
      detail: sanitizeErrorMessage(readErrorMessage(outcome.error)),
      latencyMs,
    })
  );
}

function sanitizeErrorMessage(message: string): string {
  return message.replaceAll(/password[=:]\s*\S+/gi, "password=***");
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
