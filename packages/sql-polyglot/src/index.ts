import {
  QueryValidationFailure,
  createPreparedReadOnlyQuery,
  toErrorMessage as toQueryErrorMessage,
} from "@onequery/query";
import type {
  DatabaseQueryResult,
  PreparedReadOnlyQuery,
  QueryProviderId,
  SqlValidator,
} from "@onequery/query";
import {
  Dialect,
  ast as polyglotAst,
  init as initPolyglot,
  parse,
  tokenize,
  validate as validateSqlSyntax,
} from "@polyglot-sql/sdk";
import type * as PolyglotSdk from "@polyglot-sql/sdk";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

const OUTFILE_ERROR = "SELECT INTO OUTFILE/DUMPFILE is not allowed";
const ERRORS = {
  cteSelectOnly: "CTEs must only contain SELECT statements",
  unsafeFunction: (name: string) =>
    `Side-effecting SQL functions are not allowed: ${name}`,
  locking: "SELECT locking clauses are not allowed",
  selectInto: "SELECT INTO is not allowed",
} as const;

type Violation =
  | Exclude<(typeof ERRORS)[keyof typeof ERRORS], (name: string) => string>
  | typeof OUTFILE_ERROR
  | ReturnType<typeof ERRORS.unsafeFunction>;

type ValidationValue = {
  sql: string;
};

export type CliQueryValidationFailure =
  | {
      detail: string;
      kind: "query_rejected";
    }
  | {
      detail: string;
      hint: string;
      kind: "query_preparation_failed";
    };

type SqlValidationErrorReason =
  | "cte_must_select"
  | "empty_query"
  | "locking_not_allowed"
  | "multiple_statements"
  | "non_select_query"
  | "parse_failed"
  | "parser_init_failed"
  | "unsafe_function"
  | "select_into_not_allowed";

class SqlValidationError extends TaggedError("SqlValidationError")<{
  reason: SqlValidationErrorReason;
  message: string;
  cause?: unknown;
}>() {}

type ValidationResult = ResultType<ValidationValue, SqlValidationError>;

const DIALECT_MAP = {
  aws_athena_connector: Dialect.Athena,
  bigquery: Dialect.BigQuery,
  cloudflare_d1: Dialect.SQLite,
  laminar: Dialect.ClickHouse,
  // MotherDuck executes DuckDB SQL through a PostgreSQL wire endpoint. DuckDB's
  // dialect intentionally follows PostgreSQL closely enough for our read-only
  // validator until Polyglot exposes a DuckDB dialect.
  motherduck: Dialect.PostgreSQL,
  mysql: Dialect.MySQL,
  postgres: Dialect.PostgreSQL,
  snowflake: Dialect.Snowflake,
} as const satisfies Record<QueryProviderId, Dialect>;

const SIDE_EFFECTING_EXPRESSION_KINDS = new Set([
  "add_partition",
  "alter_column",
  "alter_index",
  "alter_sequence",
  "alter_session",
  "alter_set",
  "alter_sort_key",
  "alter_table",
  "alter_view",
  "analyze",
  "analyze_delete",
  "analyze_histogram",
  "analyze_list_chained_rows",
  "analyze_sample",
  "analyze_statistics",
  "analyze_validate",
  "analyze_with",
  "attach",
  "cache",
  "command",
  "comment",
  "commit",
  "conditional_insert",
  "copy",
  "create_database",
  "create_function",
  "create_index",
  "create_procedure",
  "create_schema",
  "create_sequence",
  "create_synonym",
  "create_table",
  "create_task",
  "create_trigger",
  "create_type",
  "create_view",
  "declare",
  "delete",
  "detach",
  "drop_database",
  "drop_function",
  "drop_index",
  "drop_namespace",
  "drop_partition",
  "drop_procedure",
  "drop_schema",
  "drop_sequence",
  "drop_table",
  "drop_trigger",
  "drop_type",
  "drop_view",
  "execute",
  "export",
  "grant",
  "install",
  "insert",
  "kill",
  "load_data",
  "lock",
  "locking_statement",
  "merge",
  "multitable_inserts",
  "next_value_for",
  "pragma",
  "property_e_q",
  "put",
  "raw",
  "refresh",
  "rename_column",
  "replace_partition",
  "return_stmt",
  "revoke",
  "rollback",
  "set",
  "set_statement",
  "transaction",
  "truncate",
  "truncate_table",
  "uncache",
  "undrop",
  "update",
  "use",
]);

const POSTGRES_UNSAFE_FUNCTIONS = new Set([
  "dblink",
  "dblink_cancel_query",
  "dblink_close",
  "dblink_connect",
  "dblink_disconnect",
  "dblink_exec",
  "dblink_get_notify",
  "dblink_get_pkey",
  "dblink_get_result",
  "dblink_is_busy",
  "dblink_open",
  "dblink_send_query",
  "dblink_send_query_params",
  "lo_export",
  "lo_import",
  "lo_unlink",
  "nextval",
  "pg_advisory_lock",
  "pg_advisory_lock_shared",
  "pg_advisory_unlock",
  "pg_advisory_unlock_all",
  "pg_advisory_unlock_shared",
  "pg_advisory_xact_lock",
  "pg_advisory_xact_lock_shared",
  "pg_backup_start",
  "pg_backup_stop",
  "pg_cancel_backend",
  "pg_create_logical_replication_slot",
  "pg_create_physical_replication_slot",
  "pg_drop_replication_slot",
  "pg_export_snapshot",
  "pg_log_standby_snapshot",
  "pg_notify",
  "pg_promote",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "pg_start_backup",
  "pg_stop_backup",
  "pg_switch_wal",
  "pg_terminate_backend",
  "pg_try_advisory_lock",
  "pg_try_advisory_lock_shared",
  "pg_try_advisory_xact_lock",
  "pg_try_advisory_xact_lock_shared",
  "pg_wal_replay_pause",
  "pg_wal_replay_resume",
  "set_config",
  "setval",
]);

const MYSQL_UNSAFE_FUNCTIONS = new Set([
  "benchmark",
  "get_lock",
  "load_file",
  "release_all_locks",
  "release_lock",
  "sleep",
  "sys_eval",
  "sys_exec",
]);

const SNOWFLAKE_UNSAFE_FUNCTIONS = new Set(["system$wait"]);

type ValidationContext = {
  trimmedSql: string;
  dbType: QueryProviderId;
  dialect: (typeof DIALECT_MAP)[QueryProviderId];
};

type ParsedQuery = {
  statement: Expression;
};

type Expression = PolyglotSdk.ast.Expression;
type ExpressionRecord = Record<string, unknown>;
type TokenInfo = PolyglotSdk.TokenInfo & {
  token_type?: string;
};

type SelectData = ExpressionRecord & {
  into?: unknown;
  locks?: unknown[];
  with?: WithData | null;
};

type SetOperationData = ExpressionRecord & {
  with?: WithData | null;
};

type SubqueryData = ExpressionRecord & {
  this?: Expression;
};

type FunctionData = ExpressionRecord & {
  name?: unknown;
};

type MethodCallData = ExpressionRecord & {
  method?: unknown;
};

type IdentifierLike = {
  name?: unknown;
};

type WithData = ExpressionRecord & {
  ctes?: CteData[];
};

type CteData = ExpressionRecord & {
  this?: Expression;
};

function getSelectIntoError(dbType: QueryProviderId): Violation {
  return dbType === "mysql" ? OUTFILE_ERROR : ERRORS.selectInto;
}

function buildContext(
  sql: string,
  dbType: QueryProviderId
): ResultType<ValidationContext, SqlValidationError> {
  const trimmedSql = sql.trim();
  if (!trimmedSql) {
    return invalid("empty_query", "Query cannot be empty");
  }

  return Result.ok({
    dbType,
    dialect: DIALECT_MAP[dbType],
    trimmedSql,
  });
}

async function initSqlParser(): Promise<ResultType<null, SqlValidationError>> {
  return Result.tryPromise({
    try: async () => {
      await initPolyglot();
      return null;
    },
    catch: (cause) =>
      new SqlValidationError({
        cause,
        message: `Failed to initialize SQL parser: ${toErrorMessage(cause)}`,
        reason: "parser_init_failed",
      }),
  });
}

function validateStrictSyntax(
  context: ValidationContext
): ResultType<null, SqlValidationError> {
  return Result.try({
    try: () => {
      const outfileViolation = findMysqlOutfileClause(context);
      if (outfileViolation) {
        throw new SqlValidationError({
          message: outfileViolation,
          reason: "select_into_not_allowed",
        });
      }

      const validation = validateSqlSyntax(
        context.trimmedSql,
        context.dialect,
        {
          strictSyntax: true,
        }
      );

      const firstError = validation.errors.find(
        (error) => error.severity === "error"
      );
      if (!validation.valid || firstError) {
        throw new Error(firstError?.message ?? "unknown syntax error");
      }

      return null;
    },
    catch: (cause) =>
      cause instanceof SqlValidationError
        ? cause
        : new SqlValidationError({
            cause,
            message: `Failed to parse SQL: ${toErrorMessage(cause)}`,
            reason: "parse_failed",
          }),
  });
}

function findMysqlOutfileClause(context: ValidationContext): Violation | null {
  if (context.dbType !== "mysql") {
    return null;
  }

  const tokenization = tokenize(context.trimmedSql, context.dialect);
  if (!tokenization.success || !Array.isArray(tokenization.tokens)) {
    return null;
  }

  const tokens = tokenization.tokens as TokenInfo[];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const currentToken = tokens[index];
    const nextToken = tokens[index + 1];
    const current = normalizeTokenText(currentToken);
    const next = normalizeTokenText(nextToken);

    if (current === "into" && (next === "outfile" || next === "dumpfile")) {
      return OUTFILE_ERROR;
    }
  }

  return null;
}

function normalizeTokenText(token: TokenInfo | undefined): string {
  return (token?.text ?? token?.tokenType ?? token?.token_type ?? "")
    .trim()
    .toLowerCase();
}

async function parseStatements(
  context: ValidationContext
): Promise<ResultType<Expression[], SqlValidationError>> {
  return Result.tryPromise({
    try: async () => {
      const parsed = parse(context.trimmedSql, context.dialect);
      if (!parsed.success) {
        throw new Error(parsed.error ?? "unknown parser error");
      }

      if (!Array.isArray(parsed.ast)) {
        throw new TypeError("Failed to parse SQL: invalid AST");
      }

      return parsed.ast as Expression[];
    },
    catch: (cause) =>
      new SqlValidationError({
        cause,
        message: `Failed to parse SQL: ${toErrorMessage(cause)}`,
        reason: "parse_failed",
      }),
  });
}

function extractParsedQuery(
  statements: Expression[]
): ResultType<ParsedQuery, SqlValidationError> {
  if (statements.length !== 1) {
    return invalid(
      "multiple_statements",
      "Multiple statements are not allowed"
    );
  }

  const statement = statements[0];
  if (!isExpression(statement)) {
    return invalid("parse_failed", "Failed to parse SQL: invalid AST");
  }

  const query = unwrapParenthesizedQuery(statement);
  if (!query || !isTopLevelQueryExpression(query)) {
    const kind = getDeepestExpressionKind(statement);
    return invalid(
      "non_select_query",
      `Only SELECT queries are allowed. Got: ${kind ?? "unknown"}`
    );
  }

  return Result.ok({ statement });
}

function validateReadOnlyQuery(
  parsedQuery: ParsedQuery,
  dbType: QueryProviderId
): ResultType<null, SqlValidationError> {
  const cteViolation = findCteViolation(parsedQuery.statement);
  if (cteViolation) {
    return invalid("cte_must_select", cteViolation);
  }

  const selectIntoViolation = findSelectIntoViolationInQuery(
    parsedQuery.statement,
    dbType
  );
  if (selectIntoViolation) {
    return invalid("select_into_not_allowed", selectIntoViolation);
  }

  const lockingViolation = findLockingViolation(parsedQuery.statement);
  if (lockingViolation) {
    return invalid("locking_not_allowed", lockingViolation);
  }

  const unsafeFunctionViolation = findUnsafeFunctionViolation(
    parsedQuery.statement,
    dbType
  );
  if (unsafeFunctionViolation) {
    return invalid("unsafe_function", unsafeFunctionViolation);
  }

  const mutableKind = findSideEffectingExpressionKind(parsedQuery.statement);
  if (mutableKind) {
    return invalid(
      "non_select_query",
      `Only SELECT queries are allowed. Got: ${mutableKind}`
    );
  }

  return Result.ok(null);
}

function finalizeSql(context: ValidationContext): ValidationResult {
  return Result.ok({ sql: context.trimmedSql });
}

function isExpression(value: unknown): value is Expression {
  return polyglotAst.isExpressionValue(value);
}

function getExpressionKind(expr: Expression | undefined): string {
  return expr && isExpression(expr) ? polyglotAst.getExprType(expr) : "unknown";
}

function getDeepestExpressionKind(expr: Expression | undefined): string | null {
  if (!expr || !isExpression(expr)) {
    return null;
  }

  const subquery = getExpressionData<SubqueryData>(expr, "subquery");
  if (subquery?.this && isExpression(subquery.this)) {
    return getDeepestExpressionKind(subquery.this);
  }

  return getExpressionKind(expr);
}

function getExpressionData<T extends ExpressionRecord>(
  expr: Expression | undefined,
  kind: string
): T | null {
  if (!expr || !isExpression(expr) || getExpressionKind(expr) !== kind) {
    return null;
  }

  const data = polyglotAst.getExprData(expr);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  return data as T;
}

function getSetOperationData(expr: Expression): SetOperationData | null {
  if (!polyglotAst.isSetOperation(expr)) {
    return null;
  }

  const kind = getExpressionKind(expr);
  return getExpressionData<SetOperationData>(expr, kind);
}

function unwrapParenthesizedQuery(expr: Expression): Expression | null {
  if (isTopLevelQueryExpression(expr)) {
    return expr;
  }

  if (!polyglotAst.isSubquery(expr)) {
    return null;
  }

  const subquery = getExpressionData<SubqueryData>(expr, "subquery");
  if (!subquery?.this || !isExpression(subquery.this)) {
    return null;
  }
  return unwrapParenthesizedQuery(subquery.this);
}

function isTopLevelQueryExpression(expr: Expression): boolean {
  return polyglotAst.isSelect(expr) || polyglotAst.isSetOperation(expr);
}

function isCteQueryExpression(expr: Expression): boolean {
  const unwrapped = unwrapParenthesizedQuery(expr);
  return Boolean(unwrapped && isTopLevelQueryExpression(unwrapped));
}

function findCteViolation(query: Expression): Violation | null {
  const violatingCte = polyglotAst.findFirst(query, (expr) => {
    const withClause = getWithClause(expr);
    const ctes = Array.isArray(withClause?.ctes) ? withClause.ctes : [];
    for (const cte of ctes) {
      if (
        !cte.this ||
        !isExpression(cte.this) ||
        !isCteQueryExpression(cte.this)
      ) {
        return true;
      }
    }

    return false;
  });

  return violatingCte ? ERRORS.cteSelectOnly : null;
}

function getWithClause(expr: Expression): WithData | null {
  const select = getExpressionData<SelectData>(expr, "select");
  if (select?.with) {
    return select.with;
  }

  const setOperation = getSetOperationData(expr);
  return setOperation?.with ?? null;
}

function findSelectIntoViolationInQuery(
  query: Expression,
  dbType: QueryProviderId
): Violation | null {
  const selectInto = polyglotAst.findFirst(query, (expr) => {
    const select = getExpressionData<SelectData>(expr, "select");
    return Boolean(select?.into);
  });

  return selectInto ? getSelectIntoError(dbType) : null;
}

function findLockingViolation(query: Expression): Violation | null {
  const lockingSelect = polyglotAst.findFirst(query, (expr) => {
    const select = getExpressionData<SelectData>(expr, "select");
    return Array.isArray(select?.locks) && select.locks.length > 0;
  });

  return lockingSelect ? ERRORS.locking : null;
}

function findUnsafeFunctionViolation(
  query: Expression,
  dbType: QueryProviderId
): Violation | null {
  const unsafeFunctionCall = polyglotAst.findFirst(query, (expr) => {
    const functionName = getCalledFunctionName(expr);
    if (!functionName || !isUnsafeFunctionName(functionName, dbType)) {
      return false;
    }

    return true;
  });

  const functionName = unsafeFunctionCall
    ? getCalledFunctionName(unsafeFunctionCall)
    : null;
  return functionName ? ERRORS.unsafeFunction(functionName) : null;
}

function getCalledFunctionName(expr: Expression): string | null {
  const functionData = getExpressionData<FunctionData>(expr, "function");
  if (functionData) {
    return normalizeIdentifierName(functionData.name);
  }

  const methodCallData = getExpressionData<MethodCallData>(expr, "method_call");
  if (methodCallData) {
    return normalizeIdentifierName(methodCallData.method);
  }

  return null;
}

function normalizeIdentifierName(value: unknown): string | null {
  const rawName =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as IdentifierLike).name
        : null;
  if (typeof rawName !== "string") {
    return null;
  }

  const normalized = rawName
    .trim()
    .replace(/^[`"[]|[`"\]]$/gu, "")
    .toLowerCase();
  const parts = normalized.split(".");
  const functionName = parts.at(-1)?.trim() ?? "";
  return functionName.length > 0 ? functionName : null;
}

function isUnsafeFunctionName(
  functionName: string,
  dbType: QueryProviderId
): boolean {
  if (dbType === "postgres") {
    return (
      POSTGRES_UNSAFE_FUNCTIONS.has(functionName) ||
      functionName.startsWith("dblink_") ||
      functionName.startsWith("pg_advisory_")
    );
  }

  if (dbType === "mysql") {
    return MYSQL_UNSAFE_FUNCTIONS.has(functionName);
  }

  if (dbType === "snowflake") {
    return (
      SNOWFLAKE_UNSAFE_FUNCTIONS.has(functionName) ||
      functionName.startsWith("system$")
    );
  }

  return false;
}

function findSideEffectingExpressionKind(query: Expression): string | null {
  const mutableExpression = polyglotAst.findFirst(query, (expr) =>
    isSideEffectingExpression(expr)
  );

  return mutableExpression ? getExpressionKind(mutableExpression) : null;
}

function isSideEffectingExpression(expr: Expression): boolean {
  return (
    polyglotAst.isInsert(expr) ||
    polyglotAst.isUpdate(expr) ||
    polyglotAst.isDelete(expr) ||
    polyglotAst.isDDL(expr) ||
    SIDE_EFFECTING_EXPRESSION_KINDS.has(getExpressionKind(expr))
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function classifyCliQueryValidationFailure(
  error: unknown
): CliQueryValidationFailure {
  if (
    error instanceof SqlValidationError &&
    (error.reason === "parser_init_failed" ||
      (error.reason === "parse_failed" &&
        error.cause instanceof TypeError &&
        error.message.includes("invalid AST")))
  ) {
    return {
      detail: error.message,
      hint: "retry the request",
      kind: "query_preparation_failed",
    };
  }

  return {
    detail: toErrorMessage(error),
    kind: "query_rejected",
  };
}

function invalid(
  reason: SqlValidationErrorReason,
  message: string
): ResultType<never, SqlValidationError> {
  return Result.err(
    new SqlValidationError({
      message,
      reason,
    })
  );
}

export async function validateAndNormalizeReadOnlyQuery(
  sql: string,
  dbType: QueryProviderId
): Promise<ValidationResult> {
  return Result.gen(async function* validateReadOnlyQueryFlow() {
    const context = yield* buildContext(sql, dbType);
    yield* Result.await(initSqlParser());
    yield* validateStrictSyntax(context);
    const statements = yield* Result.await(parseStatements(context));
    const parsedQuery = yield* extractParsedQuery(statements);
    yield* validateReadOnlyQuery(parsedQuery, context.dbType);
    return finalizeSql(context);
  });
}

export function createPolyglotSqlValidator(): SqlValidator {
  return {
    validateReadOnlySql,
  };
}

export async function validateReadOnlySql<
  Provider extends QueryProviderId,
>(input: {
  provider: Provider;
  sql: string;
}): Promise<DatabaseQueryResult<PreparedReadOnlyQuery<Provider>>> {
  const validation = await Result.tryPromise({
    try: () => validateAndNormalizeReadOnlyQuery(input.sql, input.provider),
    catch: (cause) =>
      new QueryValidationFailure({
        cause,
        message: toQueryErrorMessage(cause),
        provider: input.provider,
      }),
  });

  if (validation.isErr()) {
    return validation;
  }

  if (validation.value.isErr()) {
    return Result.err(
      new QueryValidationFailure({
        cause: validation.value.error,
        message: validation.value.error.message,
        provider: input.provider,
      })
    );
  }

  return Result.ok(
    createPreparedReadOnlyQuery({
      normalizedSql: validation.value.value.sql,
      provider: input.provider,
    })
  );
}
