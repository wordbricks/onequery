import type { PostgresCredentials } from "@onequery/db/server";
import { runPostgresConnectionTest } from "@onequery/query-node/providers/postgres/driver";
import type { ConnectionTestOutcome } from "@onequery/query/connection-test";
import { createQueryDeadline } from "@onequery/query/timeout";

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
