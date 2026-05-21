import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import { DataSourceQueryExecutionError } from "./errors";
import type { QueryDeadline } from "./timeout";

export type ConnectionTestSuccess = {
  latencyMs: number;
  message: string;
};

export class ConnectionTestFailure extends TaggedError(
  "ConnectionTestFailure"
)<{
  detail: string;
  latencyMs: number;
  message: string;
}>() {}

export type UnsupportedTestReason = "oauth" | "not_implemented";

export class UnsupportedDataSourceTestError extends TaggedError(
  "UnsupportedDataSourceTestError"
)<{
  message: string;
  reason: UnsupportedTestReason;
}>() {}

export type ConnectionTestOutcome = ResultType<
  ConnectionTestSuccess,
  ConnectionTestFailure
>;

export type DataSourceTestOutcome = ResultType<
  ConnectionTestSuccess,
  ConnectionTestFailure | UnsupportedDataSourceTestError
>;

export const OAUTH_UNSUPPORTED_MESSAGE =
  "Testing is not supported for OAuth-based providers. They are tested during the authorization flow.";
export const GENERIC_UNSUPPORTED_MESSAGE =
  "Testing is not supported for this provider.";

export function createSuccessfulConnectionTest(
  latencyMs: number
): ConnectionTestSuccess {
  return {
    latencyMs,
    message: `Connection successful (${latencyMs}ms)`,
  };
}

export function createFailedConnectionTest(input: {
  detail: string;
  latencyMs: number;
  message?: string;
}): ConnectionTestFailure {
  return new ConnectionTestFailure({
    detail: input.detail,
    latencyMs: input.latencyMs,
    message: input.message ?? "Connection failed",
  });
}

export function createTimedOutConnectionTest(
  timeoutMs: number,
  latencyMs: number
): ConnectionTestFailure {
  return createFailedConnectionTest({
    detail: `Connection timed out after ${Math.round(timeoutMs / 1_000)} seconds`,
    latencyMs,
    message: "Connection timed out",
  });
}

export function createUnsupportedConnectionTest(
  reason: UnsupportedTestReason,
  message = reason === "oauth"
    ? OAUTH_UNSUPPORTED_MESSAGE
    : GENERIC_UNSUPPORTED_MESSAGE
): UnsupportedDataSourceTestError {
  return new UnsupportedDataSourceTestError({
    message,
    reason,
  });
}

export async function runProviderConnectionTest(input: {
  deadline: QueryDeadline;
  execute: () => Promise<unknown>;
  mapError?: (
    error: unknown,
    latencyMs: number
  ) => ConnectionTestFailure | null;
  sanitizeError?: (message: string) => string;
}): Promise<ConnectionTestOutcome> {
  const startTime = Date.now();
  const execution = await Result.tryPromise(input.execute);
  const latencyMs = Date.now() - startTime;

  if (execution.isOk()) {
    return Result.ok(createSuccessfulConnectionTest(latencyMs));
  }

  if (
    execution.error instanceof DataSourceQueryExecutionError &&
    execution.error.timedOut
  ) {
    return Result.err(
      createTimedOutConnectionTest(input.deadline.timeoutMs, latencyMs)
    );
  }

  const mappedResult = input.mapError?.(execution.error, latencyMs);
  if (mappedResult) {
    return Result.err(mappedResult);
  }

  const message =
    execution.error instanceof Error
      ? execution.error.message
      : String(execution.error);

  return Result.err(
    createFailedConnectionTest({
      detail: input.sanitizeError?.(message) ?? message,
      latencyMs,
    })
  );
}
