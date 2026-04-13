import {
  CliProblemCode,
  CliProblemStage,
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

export type CliProblemCatalogEntry = {
  type: `${typeof CLI_PROBLEM_TYPE_PREFIX}/${string}`;
  status: number;
  connectCode: CliConnectCode;
  title: string;
  code: CliProblemCode;
  stage: CliProblemStage;
  retryable: boolean;
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

export function cliProblemCodeToString(code: CliProblemCode) {
  return requireEnumMemberName(
    code,
    CliProblemCode,
    "problem code"
  ).toLowerCase();
}

export function cliProblemStageToString(stage: CliProblemStage) {
  return requireEnumMemberName(
    stage,
    CliProblemStage,
    "problem stage"
  ).toLowerCase();
}

function createInvalidRequestProblem(input: {
  stage: CliProblemStage;
  type: string;
  hint: string;
}) {
  return {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/${input.type}`,
    status: 422,
    connectCode: "invalid_argument",
    title: "Invalid Request",
    code: CliProblemCode.INVALID_REQUEST,
    stage: input.stage,
    retryable: false,
    hint: input.hint,
  } satisfies CliProblemCatalogEntry;
}

export const CLI_PROBLEM_CATALOG = {
  FORBIDDEN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/forbidden`,
    status: 403,
    connectCode: "permission_denied",
    title: "Forbidden",
    code: CliProblemCode.FORBIDDEN,
    stage: CliProblemStage.RESOLVE_ORG,
    retryable: false,
    hint: "verify org membership and retry",
  },
  AUTH_REQUEST_INVALID: createInvalidRequestProblem({
    hint: "correct the auth request and retry",
    stage: CliProblemStage.AUTH,
    type: "auth-request-invalid",
  }),
  SOURCE_REQUEST_INVALID: createInvalidRequestProblem({
    hint: "correct the source request and retry",
    stage: CliProblemStage.RESOLVE_SOURCE,
    type: "source-request-invalid",
  }),
  READ_QUERY_INPUT_INVALID: createInvalidRequestProblem({
    hint: "correct the query input and retry",
    stage: CliProblemStage.READ_QUERY_INPUT,
    type: "read-query-input-invalid",
  }),
  EXECUTE_QUERY_REQUEST_INVALID: createInvalidRequestProblem({
    hint: "correct the query request and retry",
    stage: CliProblemStage.EXECUTE_QUERY,
    type: "execute-query-request-invalid",
  }),
  LOGIN_DENIED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-denied`,
    status: 403,
    connectCode: "permission_denied",
    title: "Login Denied",
    code: CliProblemCode.LOGIN_DENIED,
    stage: CliProblemStage.AUTH,
    retryable: false,
    hint: "run `onequery auth login` again",
  },
  LOGIN_RATE_LIMITED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-rate-limited`,
    status: 429,
    connectCode: "resource_exhausted",
    title: "Login Rate Limited",
    code: CliProblemCode.LOGIN_RATE_LIMITED,
    stage: CliProblemStage.AUTH,
    retryable: true,
    hint: "wait briefly, then retry `onequery auth login`",
  },
  LOGIN_SESSION_EXPIRED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-session-expired`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Login Session Expired",
    code: CliProblemCode.LOGIN_SESSION_EXPIRED,
    stage: CliProblemStage.AUTH,
    retryable: false,
    hint: "run `onequery auth login` again",
  },
  MALFORMED_JSON: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/malformed-json`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Malformed JSON",
    code: CliProblemCode.MALFORMED_JSON,
    stage: CliProblemStage.READ_QUERY_INPUT,
    retryable: false,
    hint: "correct the request body and retry",
  },
  NOT_LOGGED_IN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/not-logged-in`,
    status: 401,
    connectCode: "unauthenticated",
    title: "Not Logged In",
    code: CliProblemCode.NOT_LOGGED_IN,
    stage: CliProblemStage.AUTH,
    retryable: false,
    hint: "login via the OneQuery web app and retry",
  },
  ORG_NOT_FOUND: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/org-not-found`,
    status: 404,
    connectCode: "not_found",
    title: "Organization Not Found",
    code: CliProblemCode.ORG_NOT_FOUND,
    stage: CliProblemStage.RESOLVE_ORG,
    retryable: false,
    hint: "run `onequery org list`",
  },
  QUERY_EXECUTION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-failed`,
    status: 500,
    connectCode: "internal",
    title: "Query Execution Failed",
    code: CliProblemCode.QUERY_EXECUTION_FAILED,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: false,
    hint: 'retry `onequery query --source <source> --sql "select ..."`',
  },
  QUERY_EXECUTION_TIMED_OUT: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-timed-out`,
    status: 504,
    connectCode: "deadline_exceeded",
    title: "Query Execution Timed Out",
    code: CliProblemCode.QUERY_EXECUTION_TIMED_OUT,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: true,
    hint: 'retry `onequery query --source <source> --sql "select ..."`',
  },
  QUERY_EXECUTION_UNAVAILABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-unavailable`,
    status: 503,
    connectCode: "unavailable",
    title: "Query Execution Unavailable",
    code: CliProblemCode.QUERY_EXECUTION_UNAVAILABLE,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: true,
    hint: 'retry `onequery query --source <source> --sql "select ..."`',
  },
  QUERY_PREPARATION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-preparation-failed`,
    status: 500,
    connectCode: "internal",
    title: "Query Preparation Failed",
    code: CliProblemCode.QUERY_PREPARATION_FAILED,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: false,
    hint: 'retry `onequery query --source <source> --sql "select ..."`',
  },
  QUERY_REJECTED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-rejected`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Query Rejected",
    code: CliProblemCode.QUERY_REJECTED,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: false,
    hint: "use a single read-only SELECT query",
  },
  SOURCE_API_DESCRIBE_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-describe-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Describe Failed",
    code: CliProblemCode.SOURCE_API_DESCRIBE_FAILED,
    stage: CliProblemStage.RESOLVE_SOURCE,
    retryable: false,
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_EXECUTION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-execution-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Execution Failed",
    code: CliProblemCode.SOURCE_API_EXECUTION_FAILED,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: false,
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_FORBIDDEN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-forbidden`,
    status: 403,
    connectCode: "permission_denied",
    title: "Source API Forbidden",
    code: CliProblemCode.SOURCE_API_FORBIDDEN,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: false,
    hint: "verify source API permissions and retry",
  },
  SOURCE_API_PREPARATION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-preparation-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Preparation Failed",
    code: CliProblemCode.SOURCE_API_PREPARATION_FAILED,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: false,
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_EXECUTION_STATE_INVALID: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-execution-state-invalid`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Source API Execution State Invalid",
    code: CliProblemCode.SOURCE_API_EXECUTION_STATE_INVALID,
    stage: CliProblemStage.EXECUTE_QUERY,
    retryable: false,
    hint: "rerun the `onequery api` command to refresh source API execution state",
  },
  SOURCE_API_SOURCE_UNAVAILABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-source-unavailable`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Source API Source Unavailable",
    code: CliProblemCode.SOURCE_API_SOURCE_UNAVAILABLE,
    stage: CliProblemStage.RESOLVE_SOURCE,
    retryable: false,
    hint: "review source credentials in OneQuery and retry",
  },
  SOURCE_NOT_FOUND: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-not-found`,
    status: 404,
    connectCode: "not_found",
    title: "Source Not Found",
    code: CliProblemCode.SOURCE_NOT_FOUND,
    stage: CliProblemStage.RESOLVE_SOURCE,
    retryable: false,
    hint: "run `onequery source list`",
  },
  SOURCE_NAME_CONFLICT: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-name-conflict`,
    status: 409,
    connectCode: "already_exists",
    title: "Source Name Conflict",
    code: CliProblemCode.SOURCE_NAME_CONFLICT,
    stage: CliProblemStage.RESOLVE_SOURCE,
    retryable: false,
    hint: "choose a different source name and retry",
  },
  SOURCE_NOT_QUERYABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-not-queryable`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Source Not Queryable",
    code: CliProblemCode.SOURCE_NOT_QUERYABLE,
    stage: CliProblemStage.RESOLVE_SOURCE,
    retryable: false,
    hint: "run `onequery source list` and choose a source where QUERY is yes",
  },
} as const satisfies Record<string, CliProblemCatalogEntry>;

export type CliProblemKey = keyof typeof CLI_PROBLEM_CATALOG;
export type CliProblemStatus =
  (typeof CLI_PROBLEM_CATALOG)[CliProblemKey]["status"];
