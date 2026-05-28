import { Result } from "better-result";

import {
  createFailedConnectionTest,
  createSuccessfulConnectionTest,
} from "./connection-test-outcome";
import type { ConnectionTestOutcome } from "./connection-test-outcome";
import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";

interface HttpTesterOptions<TCredentials> {
  parseError?: (
    err: Error,
    latencyMs: number,
    timeoutSeconds: number
  ) => ConnectionTestOutcome;
  probe: (credentials: TCredentials, timeoutMs: number) => Promise<unknown>;
}

export function createHttpTester<TCredentials>(
  options: HttpTesterOptions<TCredentials>
): (
  credentials: TCredentials,
  timeoutSeconds?: number
) => Promise<ConnectionTestOutcome> {
  return async (
    credentials: TCredentials,
    timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
  ): Promise<ConnectionTestOutcome> => {
    const startTime = Date.now();
    const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));

    const probeResult = await Result.tryPromise(async () =>
      options.probe(credentials, timeoutMs)
    );
    const latencyMs = Date.now() - startTime;

    if (probeResult.isOk()) {
      return Result.ok(createSuccessfulConnectionTest(latencyMs));
    }

    if (options.parseError && probeResult.error instanceof Error) {
      return options.parseError(probeResult.error, latencyMs, timeoutSeconds);
    }

    return Result.err(
      createFailedConnectionTest({
        detail:
          probeResult.error instanceof Error
            ? probeResult.error.message
            : String(probeResult.error),
        latencyMs,
      })
    );
  };
}
