import { TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

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

export type ConnectionTestOutcome = ResultType<
  ConnectionTestSuccess,
  ConnectionTestFailure
>;

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
