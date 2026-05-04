import { Code } from "@connectrpc/connect";

export type CliFailureStage =
  | "auth"
  | "execute_query"
  | "internal"
  | "read_query_input"
  | "resolve_org"
  | "resolve_source"
  | "source_api_describe"
  | "source_api_prepare"
  | "source_api_execute";

export type CliProblemTelemetryKind =
  | "workflow_corruption"
  | "workflow_internal";

export type CliProblemDefinition = {
  reason: string;
  connectCode: Code;
  stage: CliFailureStage;
  retryable: boolean;
  telemetryKind?: CliProblemTelemetryKind;
};

function defineCliProblem<const Reason extends string>(
  reason: Reason,
  input: Omit<CliProblemDefinition, "reason">
) {
  return {
    reason,
    ...input,
  } satisfies CliProblemDefinition & { reason: Reason };
}

export const CLI_PROBLEM_DEFINITIONS = {
  FORBIDDEN: defineCliProblem("FORBIDDEN", {
    connectCode: Code.PermissionDenied,
    retryable: false,
    stage: "resolve_org",
  }),
  AUTH_REQUEST_INVALID: defineCliProblem("AUTH_REQUEST_INVALID", {
    connectCode: Code.InvalidArgument,
    retryable: false,
    stage: "auth",
  }),
  SOURCE_REQUEST_INVALID: defineCliProblem("SOURCE_REQUEST_INVALID", {
    connectCode: Code.InvalidArgument,
    retryable: false,
    stage: "resolve_source",
  }),
  ORG_REQUEST_INVALID: defineCliProblem("ORG_REQUEST_INVALID", {
    connectCode: Code.InvalidArgument,
    retryable: false,
    stage: "resolve_org",
  }),
  READ_QUERY_INPUT_INVALID: defineCliProblem("READ_QUERY_INPUT_INVALID", {
    connectCode: Code.InvalidArgument,
    retryable: false,
    stage: "read_query_input",
  }),
  EXECUTE_QUERY_REQUEST_INVALID: defineCliProblem(
    "EXECUTE_QUERY_REQUEST_INVALID",
    {
      connectCode: Code.InvalidArgument,
      retryable: false,
      stage: "execute_query",
    }
  ),
  SOURCE_API_REQUEST_INVALID: defineCliProblem("SOURCE_API_REQUEST_INVALID", {
    connectCode: Code.InvalidArgument,
    retryable: false,
    stage: "source_api_execute",
  }),
  LOGIN_DENIED: defineCliProblem("LOGIN_DENIED", {
    connectCode: Code.PermissionDenied,
    retryable: false,
    stage: "auth",
  }),
  LOGIN_RATE_LIMITED: defineCliProblem("LOGIN_RATE_LIMITED", {
    connectCode: Code.ResourceExhausted,
    retryable: true,
    stage: "auth",
  }),
  LOGIN_SESSION_EXPIRED: defineCliProblem("LOGIN_SESSION_EXPIRED", {
    connectCode: Code.FailedPrecondition,
    retryable: false,
    stage: "auth",
  }),
  NOT_LOGGED_IN: defineCliProblem("NOT_LOGGED_IN", {
    connectCode: Code.Unauthenticated,
    retryable: false,
    stage: "auth",
  }),
  ORG_NOT_FOUND: defineCliProblem("ORG_NOT_FOUND", {
    connectCode: Code.NotFound,
    retryable: false,
    stage: "resolve_org",
  }),
  QUERY_EXECUTION_FAILED: defineCliProblem("QUERY_EXECUTION_FAILED", {
    connectCode: Code.Internal,
    retryable: false,
    stage: "execute_query",
  }),
  QUERY_EXECUTION_TIMED_OUT: defineCliProblem("QUERY_EXECUTION_TIMED_OUT", {
    connectCode: Code.DeadlineExceeded,
    retryable: true,
    stage: "execute_query",
  }),
  QUERY_EXECUTION_UNAVAILABLE: defineCliProblem("QUERY_EXECUTION_UNAVAILABLE", {
    connectCode: Code.Unavailable,
    retryable: true,
    stage: "execute_query",
  }),
  QUERY_PREPARATION_FAILED: defineCliProblem("QUERY_PREPARATION_FAILED", {
    connectCode: Code.Internal,
    retryable: false,
    stage: "execute_query",
  }),
  QUERY_WORKFLOW_CORRUPT: defineCliProblem("QUERY_WORKFLOW_CORRUPT", {
    connectCode: Code.DataLoss,
    retryable: false,
    stage: "internal",
    telemetryKind: "workflow_corruption",
  }),
  QUERY_WORKFLOW_INTERNAL: defineCliProblem("QUERY_WORKFLOW_INTERNAL", {
    connectCode: Code.Internal,
    retryable: false,
    stage: "internal",
    telemetryKind: "workflow_internal",
  }),
  QUERY_REJECTED: defineCliProblem("QUERY_REJECTED", {
    connectCode: Code.InvalidArgument,
    retryable: false,
    stage: "execute_query",
  }),
  SOURCE_API_DESCRIBE_FAILED: defineCliProblem("SOURCE_API_DESCRIBE_FAILED", {
    connectCode: Code.Internal,
    retryable: false,
    stage: "source_api_describe",
  }),
  SOURCE_API_EXECUTION_FAILED: defineCliProblem("SOURCE_API_EXECUTION_FAILED", {
    connectCode: Code.Internal,
    retryable: false,
    stage: "source_api_execute",
  }),
  SOURCE_API_EXECUTION_TIMED_OUT: defineCliProblem(
    "SOURCE_API_EXECUTION_TIMED_OUT",
    {
      connectCode: Code.DeadlineExceeded,
      retryable: true,
      stage: "source_api_execute",
    }
  ),
  SOURCE_API_FORBIDDEN: defineCliProblem("SOURCE_API_FORBIDDEN", {
    connectCode: Code.PermissionDenied,
    retryable: false,
    stage: "source_api_execute",
  }),
  SOURCE_API_PREPARATION_FAILED: defineCliProblem(
    "SOURCE_API_PREPARATION_FAILED",
    {
      connectCode: Code.Internal,
      retryable: false,
      stage: "source_api_prepare",
    }
  ),
  SOURCE_API_WORKFLOW_CORRUPT: defineCliProblem("SOURCE_API_WORKFLOW_CORRUPT", {
    connectCode: Code.DataLoss,
    retryable: false,
    stage: "internal",
    telemetryKind: "workflow_corruption",
  }),
  SOURCE_API_WORKFLOW_INTERNAL: defineCliProblem(
    "SOURCE_API_WORKFLOW_INTERNAL",
    {
      connectCode: Code.Internal,
      retryable: false,
      stage: "internal",
      telemetryKind: "workflow_internal",
    }
  ),
  SOURCE_API_EXECUTION_STATE_INVALID: defineCliProblem(
    "SOURCE_API_EXECUTION_STATE_INVALID",
    {
      connectCode: Code.FailedPrecondition,
      retryable: false,
      stage: "source_api_execute",
    }
  ),
  SOURCE_API_SOURCE_UNAVAILABLE: defineCliProblem(
    "SOURCE_API_SOURCE_UNAVAILABLE",
    {
      connectCode: Code.FailedPrecondition,
      retryable: false,
      stage: "resolve_source",
    }
  ),
  SOURCE_NOT_FOUND: defineCliProblem("SOURCE_NOT_FOUND", {
    connectCode: Code.NotFound,
    retryable: false,
    stage: "resolve_source",
  }),
  SOURCE_NAME_CONFLICT: defineCliProblem("SOURCE_NAME_CONFLICT", {
    connectCode: Code.AlreadyExists,
    retryable: false,
    stage: "resolve_source",
  }),
  SOURCE_QUERY_INTERFACE_MISSING: defineCliProblem(
    "SOURCE_QUERY_INTERFACE_MISSING",
    {
      connectCode: Code.InvalidArgument,
      retryable: false,
      stage: "resolve_source",
    }
  ),
} as const satisfies Record<string, CliProblemDefinition>;

export type CliProblemReason = keyof typeof CLI_PROBLEM_DEFINITIONS;
export type CliProblemKey = CliProblemReason;
