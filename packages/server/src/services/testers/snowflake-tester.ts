import type { SnowflakeCredentials } from "@onequery/db/server";
import { runSnowflakeConnectionTest } from "@onequery/query-node/providers/snowflake/driver";
import type { ConnectionTestOutcome } from "@onequery/query/connection-test";
import { createQueryDeadline } from "@onequery/query/timeout";

import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

export async function testSnowflakeConnection(
  credentials: SnowflakeCredentials,
  timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestOutcome> {
  return runSnowflakeConnectionTest(
    credentials,
    createQueryDeadline(timeoutSeconds * 1000)
  );
}
