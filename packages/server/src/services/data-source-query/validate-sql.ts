import type { DatabaseCredentialProviderType } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import { ensureSqlParserInit, parseSqlStatements } from "./sql-parser-wasm";

const OUTFILE_ERROR = "SELECT INTO OUTFILE/DUMPFILE is not allowed";
const ERRORS = {
  cteSelectOnly: "CTEs must only contain SELECT statements",
  locking: "SELECT locking clauses are not allowed",
  selectInto: "SELECT INTO is not allowed",
  unsafeFunction: (name: string) =>
    `Side-effecting SQL functions are not allowed: ${name}`,
} as const;

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
  | "select_into_not_allowed"
  | "unsafe_function";

class SqlValidationError extends TaggedError("SqlValidationError")<{
  cause?: unknown;
  message: string;
  reason: SqlValidationErrorReason;
}>() {}

type ValidationResult = ResultType<ValidationValue, SqlValidationError>;

const DIALECT_MAP = {
  aws_athena_connector: "hive",
  bigquery: "bigquery",
  cloudflare_d1: "sqlite",
  laminar: "clickhouse",
  motherduck: "postgres",
  mysql: "mysql",
  postgres: "postgres",
} as const satisfies Record<DatabaseCredentialProviderType, string>;

const MUTATING_STATEMENT_KEYS = new Set([
  "AlterTable",
  "Analyze",
  "AttachDatabase",
  "CreateFunction",
  "CreateIndex",
  "CreateTable",
  "CreateTrigger",
  "CreateView",
  "Delete",
  "DetachDatabase",
  "Drop",
  "DropFunction",
  "DropIndex",
  "DropTable",
  "DropTrigger",
  "DropView",
  "Insert",
  "Pragma",
  "Reindex",
  "Replace",
  "Truncate",
  "Update",
  "Vacuum",
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

type ValidationContext = {
  dbType: DatabaseCredentialProviderType;
  dialect: string;
  trimmedSql: string;
};

function buildContext(
  sql: string,
  dbType: DatabaseCredentialProviderType
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
      await ensureSqlParserInit();
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

async function parseStatements(
  context: ValidationContext
): Promise<ResultType<unknown[], SqlValidationError>> {
  return Result.tryPromise({
    try: async () => {
      const outfileViolation = findMysqlOutfileClause(context);
      if (outfileViolation) {
        throw new SqlValidationError({
          message: outfileViolation,
          reason: "select_into_not_allowed",
        });
      }

      if (findLockingClauseText(context)) {
        throw new SqlValidationError({
          message: ERRORS.locking,
          reason: "locking_not_allowed",
        });
      }

      return parseSqlStatements(
        normalizeSqlForParser(context.trimmedSql),
        context.dialect
      );
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

function normalizeSqlForParser(sql: string): string {
  return sql
    .replace(/\blimit\s+\?/giu, "LIMIT 1")
    .replace(/\blimit\s+(\d+)\s+percent\b/giu, "LIMIT $1");
}

function validateParsedStatements(
  statements: unknown[],
  dbType: DatabaseCredentialProviderType
): ResultType<null, SqlValidationError> {
  if (statements.length !== 1) {
    return invalid(
      "multiple_statements",
      "Multiple statements are not allowed"
    );
  }

  const statement = statements[0];
  if (!isTopLevelReadOnlyStatement(statement)) {
    return invalid(
      "non_select_query",
      `Only SELECT queries are allowed. Got: ${getStatementKind(statement)}`
    );
  }

  if (containsCteMutation(statement)) {
    return invalid("cte_must_select", ERRORS.cteSelectOnly);
  }

  const selectIntoViolation = findSelectIntoViolation(statement, dbType);
  if (selectIntoViolation) {
    return invalid("select_into_not_allowed", selectIntoViolation);
  }

  if (containsLockingClause(statement)) {
    return invalid("locking_not_allowed", ERRORS.locking);
  }

  const unsafeFunction = findUnsafeFunction(statement, dbType);
  if (unsafeFunction) {
    return invalid("unsafe_function", ERRORS.unsafeFunction(unsafeFunction));
  }

  const mutatingStatementKind = findMutatingStatementKind(statement);
  if (mutatingStatementKind) {
    return invalid(
      "non_select_query",
      `Only SELECT queries are allowed. Got: ${mutatingStatementKind}`
    );
  }

  if (containsAssignmentOperator(statement)) {
    return invalid(
      "non_select_query",
      "Only SELECT queries are allowed. Got: assignment"
    );
  }

  return Result.ok(null);
}

function finalizeSql(context: ValidationContext): ValidationResult {
  return Result.ok({ sql: context.trimmedSql });
}

function findMysqlOutfileClause(
  context: ValidationContext
): typeof OUTFILE_ERROR | null {
  if (context.dbType !== "mysql") {
    return null;
  }

  const tokens = tokenizeSqlWithoutCommentsOrStrings(context.trimmedSql);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const current = tokens[index]?.toLowerCase();
    const next = tokens[index + 1]?.toLowerCase();
    if (current === "into" && (next === "outfile" || next === "dumpfile")) {
      return OUTFILE_ERROR;
    }
  }

  return null;
}

function findLockingClauseText(context: ValidationContext): boolean {
  if (context.dbType !== "mysql") {
    return false;
  }

  const tokens = tokenizeSqlWithoutCommentsOrStrings(context.trimmedSql).map(
    (token) => token.toLowerCase()
  );
  for (let index = 0; index < tokens.length - 3; index += 1) {
    if (
      tokens[index] === "lock" &&
      tokens[index + 1] === "in" &&
      tokens[index + 2] === "share" &&
      tokens[index + 3] === "mode"
    ) {
      return true;
    }
  }

  return false;
}

function tokenizeSqlWithoutCommentsOrStrings(sql: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let index = 0;

  const flush = () => {
    if (token.length > 0) {
      tokens.push(token);
      token = "";
    }
  };

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (current === "-" && next === "-") {
      flush();
      index += 2;
      while (index < sql.length && sql[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      flush();
      index += 2;
      while (
        index < sql.length &&
        !(sql[index] === "*" && sql[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (current === "'" || current === '"' || current === "`") {
      flush();
      const quote = current;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (/[A-Za-z_]/u.test(current ?? "")) {
      token += current;
      index += 1;
      continue;
    }

    flush();
    index += 1;
  }

  flush();
  return tokens;
}

function isTopLevelReadOnlyStatement(statement: unknown): boolean {
  return (
    isQueryStatement(statement) && isReadOnlyQueryBody(getQueryBody(statement))
  );
}

function isReadOnlyQueryBody(body: unknown): boolean {
  if (!isRecord(body)) {
    return false;
  }

  if ("Select" in body) {
    return true;
  }

  if ("Query" in body) {
    return isReadOnlyQueryBody(body.Query);
  }

  if ("body" in body) {
    return isReadOnlyQueryBody(body.body);
  }

  if ("SetOperation" in body) {
    const operation = body.SetOperation;
    return (
      isRecord(operation) &&
      isReadOnlyQueryBody(operation.left) &&
      isReadOnlyQueryBody(operation.right)
    );
  }

  return false;
}

function containsCteMutation(value: unknown): boolean {
  if (!isQueryStatement(value)) {
    return false;
  }

  const cteTables = value.Query.with;
  if (!isRecord(cteTables) || !Array.isArray(cteTables.cte_tables)) {
    return false;
  }

  return cteTables.cte_tables.some((cteTable) => {
    if (!isRecord(cteTable)) {
      return true;
    }

    return !isReadOnlyQueryBody(getQueryBody(cteTable.query));
  });
}

function findSelectIntoViolation(
  value: unknown,
  dbType: DatabaseCredentialProviderType
): string | null {
  if (containsSelectInto(value)) {
    return dbType === "mysql" ? OUTFILE_ERROR : ERRORS.selectInto;
  }

  return null;
}

function containsSelectInto(value: unknown): boolean {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      return value.some(containsSelectInto);
    }
    return false;
  }

  const select = value.Select;
  if (isRecord(select) && select.into !== undefined && select.into !== null) {
    return true;
  }

  return Object.values(value).some(containsSelectInto);
}

function containsLockingClause(value: unknown): boolean {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      return value.some(containsLockingClause);
    }
    return false;
  }

  if (Array.isArray(value.locks) && value.locks.length > 0) {
    return true;
  }

  for (const child of Object.values(value)) {
    if (containsLockingClause(child)) {
      return true;
    }
  }

  return false;
}

function findUnsafeFunction(
  value: unknown,
  dbType: DatabaseCredentialProviderType
): string | null {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const unsafe = findUnsafeFunction(item, dbType);
        if (unsafe) {
          return unsafe;
        }
      }
    }
    return null;
  }

  if (isRecord(value.Function)) {
    const functionName = normalizeFunctionName(value.Function.name);
    if (functionName && isUnsafeFunctionName(functionName, dbType)) {
      return functionName;
    }
  }

  for (const child of Object.values(value)) {
    const unsafe = findUnsafeFunction(child, dbType);
    if (unsafe) {
      return unsafe;
    }
  }

  return null;
}

function normalizeFunctionName(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((part) => {
      if (!isRecord(part) || !isRecord(part.Identifier)) {
        return null;
      }
      return typeof part.Identifier.value === "string"
        ? part.Identifier.value
        : null;
    })
    .filter((part): part is string => part !== null);

  const functionName = parts.at(-1)?.trim().toLowerCase() ?? "";
  return functionName.length > 0 ? functionName : null;
}

function isUnsafeFunctionName(
  functionName: string,
  dbType: DatabaseCredentialProviderType
): boolean {
  if (dbType === "postgres" || dbType === "motherduck") {
    return (
      POSTGRES_UNSAFE_FUNCTIONS.has(functionName) ||
      functionName.startsWith("dblink_") ||
      functionName.startsWith("pg_advisory_")
    );
  }

  if (dbType === "mysql") {
    return MYSQL_UNSAFE_FUNCTIONS.has(functionName);
  }

  return false;
}

function findMutatingStatementKind(value: unknown): string | null {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const kind = findMutatingStatementKind(item);
        if (kind) {
          return kind;
        }
      }
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (MUTATING_STATEMENT_KEYS.has(key)) {
      return normalizeStatementKind(key);
    }

    const nested = findMutatingStatementKind(child);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function containsAssignmentOperator(value: unknown): boolean {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      return value.some(containsAssignmentOperator);
    }
    return false;
  }

  if (value.op === "Assignment") {
    return true;
  }

  return Object.values(value).some(containsAssignmentOperator);
}

function isQueryStatement(
  value: unknown
): value is { Query: Record<string, unknown> } {
  return isRecord(value) && isRecord(value.Query);
}

function getQueryBody(value: unknown): unknown {
  if (isQueryStatement(value)) {
    return value.Query.body;
  }

  if (isRecord(value) && "body" in value) {
    return value.body;
  }

  return undefined;
}

function getStatementKind(statement: unknown): string {
  if (!isRecord(statement)) {
    return "unknown";
  }

  return normalizeStatementKind(Object.keys(statement)[0] ?? "unknown");
}

function normalizeStatementKind(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/gu, "$1_$2")
    .toLowerCase();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export async function validateAndNormalizeReadOnlyQuery(
  sql: string,
  dbType: DatabaseCredentialProviderType
): Promise<ValidationResult> {
  return Result.gen(async function* validateReadOnlyQueryFlow() {
    const context = yield* buildContext(sql, dbType);
    yield* Result.await(initSqlParser());
    const statements = yield* Result.await(parseStatements(context));
    yield* validateParsedStatements(statements, context.dbType);
    return finalizeSql(context);
  });
}
