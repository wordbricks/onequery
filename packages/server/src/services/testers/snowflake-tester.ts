import type { SnowflakeCredentials } from "@onequery/db/server";

import { createQueryDeadline } from "../data-source-query/core/timeout";
import { runSnowflakeConnectionTest } from "../data-source-query/providers/snowflake/driver";
import type { ConnectionTestOutcome } from "./connection-test-outcome";
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
