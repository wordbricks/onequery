import { DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS } from "./defaults";
import type { ConnectionTestResult } from "./postgres-tester";

interface HttpTesterOptions<TCredentials> {
  parseError?: (
    err: Error,
    latencyMs: number,
    timeoutSeconds: number
  ) => ConnectionTestResult;
  probe: (credentials: TCredentials, timeoutMs: number) => Promise<unknown>;
}

function createSuccessResult(latencyMs: number): ConnectionTestResult {
  return {
    latencyMs,
    message: `Connection successful (${latencyMs}ms)`,
    success: true,
  };
}

function createFailureResult(
  error: string,
  latencyMs: number
): ConnectionTestResult {
  return {
    error,
    latencyMs,
    message: "Connection failed",
    success: false,
  };
}

export function createHttpTester<TCredentials>(
  options: HttpTesterOptions<TCredentials>
): (
  credentials: TCredentials,
  timeoutSeconds?: number
) => Promise<ConnectionTestResult> {
  return async (
    credentials: TCredentials,
    timeoutSeconds = DEFAULT_CONNECTION_TEST_TIMEOUT_SECONDS
  ): Promise<ConnectionTestResult> => {
    const startTime = Date.now();
    const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));

    try {
      await options.probe(credentials, timeoutMs);
      return createSuccessResult(Date.now() - startTime);
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      if (options.parseError && error instanceof Error) {
        return options.parseError(error, latencyMs, timeoutSeconds);
      }

      return createFailureResult(
        error instanceof Error ? error.message : String(error),
        latencyMs
      );
    }
  };
}
