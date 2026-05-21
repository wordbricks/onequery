import type { PostgresCredentials } from "@onequery/db/server";

import { createQueryDeadline } from "../data-source-query/core/timeout";
import { runPostgresConnectionTest } from "../data-source-query/providers/postgres/driver";
import type { ConnectionTestOutcome } from "./connection-test-outcome";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

export async function testPostgresConnection(
  credentials: PostgresCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestOutcome> {
  return runPostgresConnectionTest(
    credentials,
    createQueryDeadline(timeoutSeconds * 1000)
  );
}
