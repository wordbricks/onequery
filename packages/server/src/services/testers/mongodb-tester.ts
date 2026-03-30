import type { MongoDBCredentials } from "@onequery/db/server";

import { listMongoDatabases } from "../mongodb/relay";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";
import type { ConnectionTestResult } from "./mysql-tester";

export async function testMongoConnection(
  credentials: MongoDBCredentials,
  _timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  // NOTE: Relay currently owns Mongo connection timeout configuration.
  return listMongoDatabases({ credentials })
    .then(() => {
      const latencyMs = Date.now() - startTime;
      return {
        latencyMs,
        message: `Connection successful (${latencyMs}ms)`,
        success: true,
      };
    })
    .catch((error: unknown) => {
      const latencyMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        error: errorMessage,
        latencyMs,
        message: "Connection failed",
        success: false,
      };
    });
}
