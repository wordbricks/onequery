export const CLI_PROBLEM_TYPE_PREFIX = "https://onequery.invalid/problems/cli";

const CLI_ERROR_CODES = [
  "forbidden",
  "invalid_request",
  "login_denied",
  "login_rate_limited",
  "login_session_expired",
  "not_logged_in",
  "org_not_found",
  "query_execution_failed",
  "query_execution_timed_out",
  "query_execution_unavailable",
  "query_preparation_failed",
  "query_rejected",
  "source_api_describe_failed",
  "source_api_execution_failed",
  "source_api_forbidden",
  "source_api_preparation_failed",
  "source_api_prepared_request_invalid",
  "source_api_source_unavailable",
  "source_not_found",
  "source_name_conflict",
  "source_not_queryable",
] as const;

export const CLI_ERROR_STAGES = [
  "auth",
  "execute_query",
  "read_query_input",
  "resolve_org",
  "resolve_source",
] as const;

type CliApiErrorCode = (typeof CLI_ERROR_CODES)[number];
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
export type CliApiErrorStage = (typeof CLI_ERROR_STAGES)[number];

export type CliProblemCatalogEntry = {
  type: `${typeof CLI_PROBLEM_TYPE_PREFIX}/${string}`;
  status: number;
  connectCode: CliConnectCode;
  title: string;
  code: CliApiErrorCode;
  stage?: CliApiErrorStage;
  retryable: boolean;
  hint?: string;
};

export const CLI_PROBLEM_CATALOG = {
  FORBIDDEN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/forbidden`,
    status: 403,
    connectCode: "permission_denied",
    title: "Forbidden",
    code: "forbidden",
    stage: "resolve_org",
    retryable: false,
    hint: "verify org membership and retry",
  },
  INVALID_REQUEST: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/invalid-request`,
    status: 422,
    connectCode: "invalid_argument",
    title: "Invalid Request",
    code: "invalid_request",
    retryable: false,
  },
  LOGIN_DENIED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-denied`,
    status: 403,
    connectCode: "permission_denied",
    title: "Login Denied",
    code: "login_denied",
    stage: "auth",
    retryable: false,
    hint: "run `onequery auth login` again",
  },
  LOGIN_RATE_LIMITED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-rate-limited`,
    status: 429,
    connectCode: "resource_exhausted",
    title: "Login Rate Limited",
    code: "login_rate_limited",
    stage: "auth",
    retryable: true,
    hint: "wait briefly, then retry `onequery auth login`",
  },
  LOGIN_SESSION_EXPIRED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-session-expired`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Login Session Expired",
    code: "login_session_expired",
    stage: "auth",
    retryable: false,
    hint: "run `onequery auth login` again",
  },
  MALFORMED_JSON: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/malformed-json`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Malformed JSON",
    code: "invalid_request",
    stage: "read_query_input",
    retryable: false,
    hint: "correct the request body and retry",
  },
  NOT_LOGGED_IN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/not-logged-in`,
    status: 401,
    connectCode: "unauthenticated",
    title: "Not Logged In",
    code: "not_logged_in",
    stage: "auth",
    retryable: false,
    hint: "login via the OneQuery web app and retry",
  },
  ORG_NOT_FOUND: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/org-not-found`,
    status: 404,
    connectCode: "not_found",
    title: "Organization Not Found",
    code: "org_not_found",
    stage: "resolve_org",
    retryable: false,
    hint: "run `onequery org list`",
  },
  QUERY_EXECUTION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-failed`,
    status: 500,
    connectCode: "internal",
    title: "Query Execution Failed",
    code: "query_execution_failed",
    stage: "execute_query",
    retryable: false,
    hint: 'retry `onequery query --source <source> --sql "select ..."`',
  },
  QUERY_EXECUTION_TIMED_OUT: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-timed-out`,
    status: 504,
    connectCode: "deadline_exceeded",
    title: "Query Execution Timed Out",
    code: "query_execution_timed_out",
    stage: "execute_query",
    retryable: true,
    hint: 'retry `onequery query --source <source> --sql "select ..."`',
  },
  QUERY_EXECUTION_UNAVAILABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-unavailable`,
    status: 503,
    connectCode: "unavailable",
    title: "Query Execution Unavailable",
    code: "query_execution_unavailable",
    stage: "execute_query",
    retryable: true,
    hint: 'retry `onequery query --source <source> --sql "select ..."`',
  },
  QUERY_PREPARATION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-preparation-failed`,
    status: 500,
    connectCode: "internal",
    title: "Query Preparation Failed",
    code: "query_preparation_failed",
    stage: "execute_query",
    retryable: false,
    hint: 'retry `onequery query --source <source> --sql "select ..."`',
  },
  QUERY_REJECTED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-rejected`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Query Rejected",
    code: "query_rejected",
    stage: "execute_query",
    retryable: false,
    hint: "use a single read-only SELECT query",
  },
  SOURCE_API_DESCRIBE_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-describe-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Describe Failed",
    code: "source_api_describe_failed",
    stage: "resolve_source",
    retryable: false,
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_EXECUTION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-execution-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Execution Failed",
    code: "source_api_execution_failed",
    stage: "execute_query",
    retryable: false,
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_FORBIDDEN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-forbidden`,
    status: 403,
    connectCode: "permission_denied",
    title: "Source API Forbidden",
    code: "source_api_forbidden",
    stage: "execute_query",
    retryable: false,
    hint: "verify source API permissions and retry",
  },
  SOURCE_API_PREPARATION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-preparation-failed`,
    status: 500,
    connectCode: "internal",
    title: "Source API Preparation Failed",
    code: "source_api_preparation_failed",
    stage: "execute_query",
    retryable: false,
    hint: "retry `onequery api --source <source>`",
  },
  SOURCE_API_PREPARED_REQUEST_INVALID: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-prepared-request-invalid`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Prepared Source API Request Invalid",
    code: "source_api_prepared_request_invalid",
    stage: "execute_query",
    retryable: false,
    hint: "rerun the `onequery api` command to refresh prepared source API state",
  },
  SOURCE_API_SOURCE_UNAVAILABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-api-source-unavailable`,
    status: 410,
    connectCode: "failed_precondition",
    title: "Source API Source Unavailable",
    code: "source_api_source_unavailable",
    stage: "resolve_source",
    retryable: false,
    hint: "review source credentials in OneQuery and retry",
  },
  SOURCE_NOT_FOUND: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-not-found`,
    status: 404,
    connectCode: "not_found",
    title: "Source Not Found",
    code: "source_not_found",
    stage: "resolve_source",
    retryable: false,
    hint: "run `onequery source list`",
  },
  SOURCE_NAME_CONFLICT: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-name-conflict`,
    status: 409,
    connectCode: "already_exists",
    title: "Source Name Conflict",
    code: "source_name_conflict",
    stage: "resolve_source",
    retryable: false,
    hint: "choose a different source name and retry",
  },
  SOURCE_NOT_QUERYABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-not-queryable`,
    status: 400,
    connectCode: "invalid_argument",
    title: "Source Not Queryable",
    code: "source_not_queryable",
    stage: "resolve_source",
    retryable: false,
    hint: "run `onequery source list` and choose a source where QUERY is yes",
  },
} as const satisfies Record<string, CliProblemCatalogEntry>;

export type CliProblemKey = keyof typeof CLI_PROBLEM_CATALOG;
export type CliProblemStatus =
  (typeof CLI_PROBLEM_CATALOG)[CliProblemKey]["status"];
