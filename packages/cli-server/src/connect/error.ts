import { Code, ConnectError } from "@connectrpc/connect";

import type { CliProblemKey } from "../domain/problems";
import { CLI_REQUEST_ID_HEADER } from "../error";

export const CLI_RETRY_AFTER_MS_METADATA = "retry-after-ms";

type CliConnectErrorDefinition = {
  code: Code;
  message: string;
};

const CLI_CONNECT_ERROR_DEFINITIONS = {
  FORBIDDEN: {
    code: Code.PermissionDenied,
    message: "Forbidden",
  },
  INVALID_REQUEST: {
    code: Code.InvalidArgument,
    message: "Invalid request",
  },
  LOGIN_DENIED: {
    code: Code.PermissionDenied,
    message: "Login denied",
  },
  LOGIN_RATE_LIMITED: {
    code: Code.ResourceExhausted,
    message: "Login rate limited",
  },
  LOGIN_SESSION_EXPIRED: {
    code: Code.FailedPrecondition,
    message: "Login session expired",
  },
  MALFORMED_JSON: {
    code: Code.InvalidArgument,
    message: "Malformed JSON",
  },
  NOT_LOGGED_IN: {
    code: Code.Unauthenticated,
    message: "Not logged in",
  },
  ORG_NOT_FOUND: {
    code: Code.NotFound,
    message: "Organization not found",
  },
  QUERY_EXECUTION_FAILED: {
    code: Code.Internal,
    message: "Query execution failed",
  },
  QUERY_EXECUTION_TIMED_OUT: {
    code: Code.DeadlineExceeded,
    message: "Query execution timed out",
  },
  QUERY_EXECUTION_UNAVAILABLE: {
    code: Code.Unavailable,
    message: "Query execution unavailable",
  },
  QUERY_PREPARATION_FAILED: {
    code: Code.Internal,
    message: "Query preparation failed",
  },
  QUERY_REJECTED: {
    code: Code.InvalidArgument,
    message: "Query rejected",
  },
  SOURCE_NOT_FOUND: {
    code: Code.NotFound,
    message: "Source not found",
  },
  SOURCE_NAME_CONFLICT: {
    code: Code.AlreadyExists,
    message: "Source name conflict",
  },
  SOURCE_NOT_QUERYABLE: {
    code: Code.FailedPrecondition,
    message: "Source not queryable",
  },
} as const satisfies Record<CliProblemKey, CliConnectErrorDefinition>;

type CreateCliConnectErrorInput = {
  key: CliProblemKey;
  detail?: string;
  retryAfterMs?: number;
  cause?: unknown;
};

export function createCliConnectError(input: CreateCliConnectErrorInput) {
  const definition = CLI_CONNECT_ERROR_DEFINITIONS[input.key];
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
    input.detail ?? definition.message,
    definition.code,
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
