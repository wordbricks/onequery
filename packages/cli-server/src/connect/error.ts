import { Code, ConnectError } from "@connectrpc/connect";

import { CLI_PROBLEM_CATALOG } from "../domain/problems";
import type { CliProblemKey, CliProblemStatus } from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../error";

export const CLI_RETRY_AFTER_MS_METADATA = "retry-after-ms";

type CreateCliConnectErrorInput = {
  key: CliProblemKey;
  detail?: string;
  retryAfterMs?: number;
  cause?: unknown;
};

function toCliConnectCode(status: CliProblemStatus): Code {
  switch (status) {
    case 400:
    case 422:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 403:
      return Code.PermissionDenied;
    case 404:
      return Code.NotFound;
    case 409:
      return Code.AlreadyExists;
    case 410:
      return Code.FailedPrecondition;
    case 429:
      return Code.ResourceExhausted;
    case 500:
      return Code.Internal;
    case 503:
      return Code.Unavailable;
    case 504:
      return Code.DeadlineExceeded;
  }

  throw new Error(`unsupported CLI problem status for Connect: ${status}`);
}

export function createCliConnectError(input: CreateCliConnectErrorInput) {
  const problem = CLI_PROBLEM_CATALOG[input.key];
  const metadata = new Headers();

  if (typeof input.retryAfterMs === "number") {
    metadata.set(
      CLI_RETRY_AFTER_MS_METADATA,
      String(Math.max(0, Math.trunc(input.retryAfterMs)))
    );
  }

  // Comment: request IDs and retry hints are the only transport metadata we
  // keep on Connect errors during the migration.
  return new ConnectError(
    input.detail ?? problem.title,
    toCliConnectCode(problem.status),
    metadata,
    [],
    input.cause
  );
}

export function throwCliConnectError(input: CreateCliConnectErrorInput): never {
  throw createCliConnectError(input);
}

export function withCliRequestId(error: ConnectError, requestId: string) {
  error.metadata.set(CLI_REQUEST_ID_HEADER, requestId);
  return error;
}
