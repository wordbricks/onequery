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
export type CliApiErrorStage = (typeof CLI_ERROR_STAGES)[number];

type CliProblemCatalogEntry = {
  type: `${typeof CLI_PROBLEM_TYPE_PREFIX}/${string}`;
  status: number;
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
    title: "Forbidden",
    code: "forbidden",
    stage: "resolve_org",
    retryable: false,
    hint: "verify org membership and retry",
  },
  INVALID_REQUEST: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/invalid-request`,
    status: 422,
    title: "Invalid Request",
    code: "invalid_request",
    retryable: false,
  },
  LOGIN_DENIED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-denied`,
    status: 403,
    title: "Login Denied",
    code: "login_denied",
    stage: "auth",
    retryable: false,
    hint: "run `oneq auth login` again",
  },
  LOGIN_RATE_LIMITED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-rate-limited`,
    status: 429,
    title: "Login Rate Limited",
    code: "login_rate_limited",
    stage: "auth",
    retryable: true,
    hint: "wait briefly, then retry `oneq auth login`",
  },
  LOGIN_SESSION_EXPIRED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/login-session-expired`,
    status: 410,
    title: "Login Session Expired",
    code: "login_session_expired",
    stage: "auth",
    retryable: false,
    hint: "run `oneq auth login` again",
  },
  MALFORMED_JSON: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/malformed-json`,
    status: 400,
    title: "Malformed JSON",
    code: "invalid_request",
    stage: "read_query_input",
    retryable: false,
    hint: "correct the request body and retry",
  },
  NOT_LOGGED_IN: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/not-logged-in`,
    status: 401,
    title: "Not Logged In",
    code: "not_logged_in",
    stage: "auth",
    retryable: false,
    hint: "login via the OneQuery web app and retry",
  },
  ORG_NOT_FOUND: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/org-not-found`,
    status: 404,
    title: "Organization Not Found",
    code: "org_not_found",
    stage: "resolve_org",
    retryable: false,
    hint: "run `oneq org list`",
  },
  QUERY_EXECUTION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-failed`,
    status: 500,
    title: "Query Execution Failed",
    code: "query_execution_failed",
    stage: "execute_query",
    retryable: false,
    hint: 'retry `oneq query --source <source> --sql "select ..."`',
  },
  QUERY_EXECUTION_TIMED_OUT: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-timed-out`,
    status: 504,
    title: "Query Execution Timed Out",
    code: "query_execution_timed_out",
    stage: "execute_query",
    retryable: true,
    hint: 'retry `oneq query --source <source> --sql "select ..."`',
  },
  QUERY_EXECUTION_UNAVAILABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-execution-unavailable`,
    status: 503,
    title: "Query Execution Unavailable",
    code: "query_execution_unavailable",
    stage: "execute_query",
    retryable: true,
    hint: 'retry `oneq query --source <source> --sql "select ..."`',
  },
  QUERY_PREPARATION_FAILED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-preparation-failed`,
    status: 500,
    title: "Query Preparation Failed",
    code: "query_preparation_failed",
    stage: "execute_query",
    retryable: false,
    hint: 'retry `oneq query --source <source> --sql "select ..."`',
  },
  QUERY_REJECTED: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/query-rejected`,
    status: 400,
    title: "Query Rejected",
    code: "query_rejected",
    stage: "execute_query",
    retryable: false,
    hint: "use a single read-only SELECT query",
  },
  SOURCE_NOT_FOUND: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-not-found`,
    status: 404,
    title: "Source Not Found",
    code: "source_not_found",
    stage: "resolve_source",
    retryable: false,
    hint: "run `oneq source list`",
  },
  SOURCE_NAME_CONFLICT: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-name-conflict`,
    status: 409,
    title: "Source Name Conflict",
    code: "source_name_conflict",
    stage: "resolve_source",
    retryable: false,
    hint: "choose a different source name and retry",
  },
  SOURCE_NOT_QUERYABLE: {
    type: `${CLI_PROBLEM_TYPE_PREFIX}/source-not-queryable`,
    status: 400,
    title: "Source Not Queryable",
    code: "source_not_queryable",
    stage: "resolve_source",
    retryable: false,
    hint: "run `oneq source list` and choose a source where QUERY is yes",
  },
} as const satisfies Record<string, CliProblemCatalogEntry>;

export type CliProblemKey = keyof typeof CLI_PROBLEM_CATALOG;
