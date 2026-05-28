import type { MongoDBCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { listMongoDatabases } from "../mongodb/relay";
import {
  createFailedConnectionTest,
  createSuccessfulConnectionTest,
} from "./connection-test-outcome";
import type { ConnectionTestOutcome } from "./connection-test-outcome";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

export async function testMongoConnection(
  credentials: MongoDBCredentials,
  _timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
): Promise<ConnectionTestOutcome> {
  const startTime = Date.now();
  const outcome = await Result.tryPromise(
    // Comment: Relay currently owns Mongo connection timeout configuration.
    async () => listMongoDatabases({ credentials })
  );
  const latencyMs = Date.now() - startTime;

  if (outcome.isOk()) {
    return Result.ok(createSuccessfulConnectionTest(latencyMs));
  }

  return Result.err(
    createFailedConnectionTest({
      detail: readErrorMessage(outcome.error),
      latencyMs,
    })
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
