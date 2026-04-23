import {
  ProblemCode,
  ProblemStage,
  SupportActionKind,
} from "../connect/gen/onequery/cli/v1/common_pb";

export const CLI_PROBLEM_TYPE_PREFIX = "https://onequery.invalid/problems/cli";

export type CliConnectCode =
  | "already_exists"
  | "deadline_exceeded"
  | "failed_precondition"
  | "internal"
  | "invalid_argument"
  | "not_found"
  | "permission_denied"
  | "resource_exhausted"
  | "unauthenticated"
  | "unavailable";

export type CliProblemSupportKind =
  | "none"
  | "retry"
  | "explain"
  | "report_if_reproducible"
  | "report_recommended";

export type CliProblemSupport = {
  kind: CliProblemSupportKind;
  reason: string;
  explainSlug: string;
};

export type CliProblemCatalogEntry = {
  type: `${typeof CLI_PROBLEM_TYPE_PREFIX}/${string}`;
  status: number;
  connectCode: CliConnectCode;
  title: string;
  code: ProblemCode;
  stage: ProblemStage;
  retryable: boolean;
  support: CliProblemSupport;
  hint?: string;
};

function requireEnumMemberName(
  value: number,
  enumObject: Record<number, string>,
  label: string
) {
  const name = enumObject[value];
  if (!name || name === "UNSPECIFIED") {
    throw new Error(`invalid ${label} enum value: ${value}`);
  }

  return name;
}

export function cliProblemCodeToString(code: ProblemCode) {
  return requireEnumMemberName(code, ProblemCode, "problem code").toLowerCase();
}

export function cliProblemStageToString(stage: ProblemStage) {
  return requireEnumMemberName(
    stage,
    ProblemStage,
    "problem stage"
  ).toLowerCase();
}

export function cliSupportActionKindToString(kind: SupportActionKind) {
  return requireEnumMemberName(
    kind,
    SupportActionKind,
    "support action kind"
  ).toLowerCase();
}

function createCliProblemSupport(
  code: ProblemCode,
  kind: CliProblemSupportKind,
  reason: string
) {
  return {
    explainSlug: cliProblemCodeToString(code),
    kind,
    reason,
  } satisfies CliProblemSupport;
}

export function createCliUserActionableSupport(code: ProblemCode) {
  return createCliProblemSupport(code, "none", "user_actionable");
}

function createCliRetrySupport(code: ProblemCode) {
  return createCliProblemSupport(code, "retry", "transient");
}

function createCliReportIfReproducibleSupport(
  code: ProblemCode,
  reason: string
) {
  return createCliProblemSupport(code, "report_if_reproducible", reason);
}

function createInvalidRequestProblem(input: {
  stage: ProblemStage;
  type: string;
  hint: string;
}) {
  return {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/${input.type}`,
    status: 422,
    connectCode: "invalid_argument",
    title: "Invalid Request",
    code: ProblemCode.INVALID_REQUEST,
    stage: input.stage,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.INVALID_REQUEST),
    hint: input.hint,
  } satisfies CliProblemCatalogEntry;
}

export const CLI_PROBLEM_CATALOG = {
  FORBIDDEN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/forbidden`,
    status: 403,
    connectCode: "permission_denied",
    title: "Forbidden",
    code: ProblemCode.FORBIDDEN,
    stage: ProblemStage.RESOLVE_ORG,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.FORBIDDEN),
    hint: "verify org membership and retry",
  },
  AUTH_REQUEST_INVALID: createInvalidRequestProblem({
    hint: "correct the auth request and retry",
    stage: ProblemStage.AUTH,
    type: "auth-request-invalid",
  }),
  SOURCE_REQUEST_INVALID: createInvalidRequestProblem({
    hint: "correct the source request and retry",
    stage: ProblemStage.RESOLVE_SOURCE,
    type: "source-request-invalid",
  }),
  READ_QUERY_INPUT_INVALID: createInvalidRequestProblem({
    hint: "correct the query input and retry",
    stage: ProblemStage.READ_QUERY_INPUT,
    type: "read-query-input-invalid",
  }),
  EXECUTE_QUERY_REQUEST_INVALID: createInvalidRequestProblem({
    hint: "correct the query request and retry",
    stage: ProblemStage.EXECUTE_QUERY,
    type: "execute-query-request-invalid",
  }),
  LOGIN_DENIED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-denied`,
    status: 403,
    connectCode: "permission_denied",
    title: "Login Denied",
    code: ProblemCode.LOGIN_DENIED,
    stage: ProblemStage.AUTH,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.LOGIN_DENIED),
    hint: "run `onequery auth login` again",
  },
  LOGIN_RATE_LIMITED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-rate-limited`,
    status: 429,
    connectCode: "resource_exhausted",
    title: "Login Rate Limited",
    code: ProblemCode.LOGIN_RATE_LIMITED,
    stage: ProblemStage.AUTH,
    retryable: true,
    support: createCliRetrySupport(ProblemCode.LOGIN_RATE_LIMITED),
    hint: "wait briefly, then retry `onequery auth login`",
  },
  LOGIN_SESSION_EXPIRED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-session-expired`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Login Session Expired",
    code: ProblemCode.LOGIN_SESSION_EXPIRED,
    stage: ProblemStage.AUTH,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.LOGIN_SESSION_EXPIRED),
    hint: "run `onequery auth login` again",
  },
  MALFORMED_JSON: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/malformed-json`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Malformed JSON",
    code: ProblemCode.MALFORMED_JSON,
    stage: ProblemStage.READ_QUERY_INPUT,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.MALFORMED_JSON),
    hint: "correct the request body and retry",
  },
  NOT_LOGGED_IN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/not-logged-in`,
    status: 401,
    connectCode: "unauthenticated",
    title: "Not Logged In",
    code: ProblemCode.NOT_LOGGED_IN,
    stage: ProblemStage.AUTH,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.NOT_LOGGED_IN),
    hint: "run `onequery auth login`",
  },
  ORG_NOT_FOUND: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/org-not-found`,
    status: 404,
    connectCode: "not_found",
    title: "Organization Not Found",
    code: ProblemCode.ORG_NOT_FOUND,
    stage: ProblemStage.RESOLVE_ORG,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.ORG_NOT_FOUND),
    hint: "run `onequery org list`",
  },
  QUERY_EXECUTION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-failed`,
    status: 500,
    connectCode: "internal",
    title: "Query Execution Failed",
    code: ProblemCode.QUERY_EXECUTION_FAILED,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: false,
    support: createCliReportIfReproducibleSupport(
      ProblemCode.QUERY_EXECUTION_FAILED,
      "query_execution_failure"
    ),
    hint: 'retry `onequery query exec --source <source> --sql "select ..."`',
  },
  QUERY_EXECUTION_TIMED_OUT: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-timed-out`,
    status: 504,
    connectCode: "deadline_exceeded",
    title: "Query Execution Timed Out",
    code: ProblemCode.QUERY_EXECUTION_TIMED_OUT,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: true,
    support: createCliRetrySupport(ProblemCode.QUERY_EXECUTION_TIMED_OUT),
    hint: 'retry `onequery query exec --source <source> --sql "select ..."`',
  },
  QUERY_EXECUTION_UNAVAILABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-unavailable`,
    status: 503,
    connectCode: "unavailable",
    title: "Query Execution Unavailable",
    code: ProblemCode.QUERY_EXECUTION_UNAVAILABLE,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: true,
    support: createCliRetrySupport(ProblemCode.QUERY_EXECUTION_UNAVAILABLE),
    hint: 'retry `onequery query exec --source <source> --sql "select ..."`',
  },
  QUERY_PREPARATION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-preparation-failed`,
    status: 500,
    connectCode: "internal",
    title: "Query Preparation Failed",
    code: ProblemCode.QUERY_PREPARATION_FAILED,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: false,
    support: createCliReportIfReproducibleSupport(
      ProblemCode.QUERY_PREPARATION_FAILED,
      "query_preparation_failure"
    ),
    hint: 'retry `onequery query exec --source <source> --sql "select ..."`',
  },
  QUERY_REJECTED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-rejected`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Query Rejected",
    code: ProblemCode.QUERY_REJECTED,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.QUERY_REJECTED),
    hint: "use a single read-only SELECT query",
  },
  SOURCE_API_DESCRIBE_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-describe-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Describe Failed",
    code: ProblemCode.SOURCE_API_DESCRIBE_FAILED,
    stage: ProblemStage.RESOLVE_SOURCE,
    retryable: false,
    support: createCliReportIfReproducibleSupport(
      ProblemCode.SOURCE_API_DESCRIBE_FAILED,
      "source_api_describe_failure"
    ),
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_EXECUTION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-execution-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Execution Failed",
    code: ProblemCode.SOURCE_API_EXECUTION_FAILED,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: false,
    support: createCliReportIfReproducibleSupport(
      ProblemCode.SOURCE_API_EXECUTION_FAILED,
      "source_api_execution_failure"
    ),
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_FORBIDDEN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-forbidden`,
    status: 403,
    connectCode: "permission_denied",
    title: "Source API Forbidden",
    code: ProblemCode.SOURCE_API_FORBIDDEN,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.SOURCE_API_FORBIDDEN),
    hint: "verify source API permissions and retry",
  },
  SOURCE_API_PREPARATION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-preparation-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Preparation Failed",
    code: ProblemCode.SOURCE_API_PREPARATION_FAILED,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: false,
    support: createCliReportIfReproducibleSupport(
      ProblemCode.SOURCE_API_PREPARATION_FAILED,
      "source_api_preparation_failure"
    ),
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_EXECUTION_STATE_INVALID: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-execution-state-invalid`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Source API Execution State Invalid",
    code: ProblemCode.SOURCE_API_EXECUTION_STATE_INVALID,
    stage: ProblemStage.EXECUTE_QUERY,
    retryable: false,
    support: createCliUserActionableSupport(
      ProblemCode.SOURCE_API_EXECUTION_STATE_INVALID
    ),
    hint: "rerun the `onequery api` command to refresh source API execution state",
  },
  SOURCE_API_SOURCE_UNAVAILABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-source-unavailable`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Source API Source Unavailable",
    code: ProblemCode.SOURCE_API_SOURCE_UNAVAILABLE,
    stage: ProblemStage.RESOLVE_SOURCE,
    retryable: false,
    support: createCliUserActionableSupport(
      ProblemCode.SOURCE_API_SOURCE_UNAVAILABLE
    ),
    hint: "review source credentials in OneQuery and retry",
  },
  SOURCE_NOT_FOUND: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-not-found`,
    status: 404,
    connectCode: "not_found",
    title: "Source Not Found",
    code: ProblemCode.SOURCE_NOT_FOUND,
    stage: ProblemStage.RESOLVE_SOURCE,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.SOURCE_NOT_FOUND),
    hint: "run `onequery source list`",
  },
  SOURCE_NAME_CONFLICT: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-name-conflict`,
    status: 409,
    connectCode: "already_exists",
    title: "Source Name Conflict",
    code: ProblemCode.SOURCE_NAME_CONFLICT,
    stage: ProblemStage.RESOLVE_SOURCE,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.SOURCE_NAME_CONFLICT),
    hint: "choose a different source name and retry",
  },
  SOURCE_NOT_QUERYABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-not-queryable`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Source Not Queryable",
    code: ProblemCode.SOURCE_NOT_QUERYABLE,
    stage: ProblemStage.RESOLVE_SOURCE,
    retryable: false,
    support: createCliUserActionableSupport(ProblemCode.SOURCE_NOT_QUERYABLE),
    hint: "run `onequery source list` and choose a source where QUERY is yes",
  },
} as const satisfies Record<string, CliProblemCatalogEntry>;

export type CliProblemKey = keyof typeof CLI_PROBLEM_CATALOG;
export type CliProblemStatus =
  (typeof CLI_PROBLEM_CATALOG)[CliProblemKey]["status"];
