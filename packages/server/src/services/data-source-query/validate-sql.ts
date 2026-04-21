import type {
  Expr,
  LimitClause,
  Query,
  SetExpr,
  Statement,
} from "@casual-simulation/sql-parser";
import type { DatabaseCredentialProviderType } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import { getNumericValueFromExpr } from "./sql-ast-utils";
import {
  ensureSqlParserInit,
  formatStatement,
  parseSqlStatements,
} from "./sql-parser-wasm";

export const MAX_LIMIT = 1000;
const OUTFILE_ERROR = "SELECT INTO OUTFILE/DUMPFILE is not allowed";
const OUTFILE_PATTERN = /\bINTO\s+(OUTFILE|DUMPFILE)\b/i;
const ERRORS = {
  cteSelectOnly: "CTEs must only contain SELECT statements",
  selectInto: "SELECT INTO is not allowed",
} as const;

type Violation = (typeof ERRORS)[keyof typeof ERRORS] | typeof OUTFILE_ERROR;

type ValidationValue = {
  sql: string;
  changed: boolean;
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
  | "limit_not_numeric"
  | "multiple_statements"
  | "non_select_query"
  | "parse_failed"
  | "parser_init_failed"
  | "select_into_not_allowed";

class SqlValidationError extends TaggedError("SqlValidationError")<{
  reason: SqlValidationErrorReason;
  message: string;
  cause?: unknown;
}>() {}

type ValidationResult = ResultType<ValidationValue, SqlValidationError>;

const DIALECT_MAP = {
  aws_athena_connector: "bigquery",
  bigquery: "bigquery",
  laminar: "clickhouse",
  mysql: "mysql",
  postgres: "postgresql",
} as const satisfies Record<DatabaseCredentialProviderType, string>;

type ValidationContext = {
  trimmedSql: string;
  dbType: DatabaseCredentialProviderType;
  dialect: (typeof DIALECT_MAP)[DatabaseCredentialProviderType];
};

type ParsedQuery = {
  statement: Statement;
  query: Query;
};

type Location = {
  line: number;
  column: number;
};

type Span = {
  start: Location;
  end: Location;
};

function loc(line = 0, column = 0): Location {
  return { column, line };
}

function span(start: Location = loc(), end: Location = loc()): Span {
  return { end, start };
}

function getStatementKind(statement: Statement): string | null {
  const entries = Object.entries(statement).filter(
    (entry) => entry[1] !== undefined
  );
  if (entries.length !== 1) {
    return null;
  }

  const kind = entries[0]?.[0];
  return typeof kind === "string" ? kind : null;
}

function getSelectIntoError(dbType: DatabaseCredentialProviderType): Violation {
  return dbType === "mysql" ? OUTFILE_ERROR : ERRORS.selectInto;
}

function buildContext(
  sql: string,
  dbType: DatabaseCredentialProviderType
): ResultType<ValidationContext, SqlValidationError> {
  const trimmedSql = sql.trim();
  if (!trimmedSql) {
    return invalid("empty_query", "Query cannot be empty");
  }

  if (dbType === "mysql" && OUTFILE_PATTERN.test(trimmedSql)) {
    return invalid("select_into_not_allowed", OUTFILE_ERROR);
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
): Promise<ResultType<Statement[], SqlValidationError>> {
  return Result.tryPromise({
    try: () =>
      Promise.resolve(parseSqlStatements(context.trimmedSql, context.dialect)),
    catch: (cause) =>
      new SqlValidationError({
        cause,
        message: `Failed to parse SQL: ${toErrorMessage(cause)}`,
        reason: "parse_failed",
      }),
  });
}

function extractParsedQuery(
  statements: Statement[]
): ResultType<ParsedQuery, SqlValidationError> {
  if (statements.length !== 1) {
    return invalid(
      "multiple_statements",
      "Multiple statements are not allowed"
    );
  }

  const statement = statements[0];
  if (!statement) {
    return invalid("parse_failed", "Failed to parse SQL: invalid AST");
  }

  const query = statement.Query;
  if (!query) {
    const kind = getStatementKind(statement);
    return invalid(
      "non_select_query",
      `Only SELECT queries are allowed. Got: ${kind?.toLowerCase() ?? "unknown"}`
    );
  }

  return Result.ok({ query, statement });
}

function validateReadOnlyQuery(
  query: Query,
  dbType: DatabaseCredentialProviderType
): ResultType<Query, SqlValidationError> {
  const cteViolation = findCteViolation(query);
  if (cteViolation) {
    return invalid("cte_must_select", cteViolation);
  }

  const selectIntoViolation = findSelectIntoViolationInQuery(query, dbType);
  if (selectIntoViolation) {
    return invalid("select_into_not_allowed", selectIntoViolation);
  }

  if (!isReadOnlyQuery(query)) {
    return invalid("non_select_query", "Only SELECT queries are allowed.");
  }

  return Result.ok(query);
}

function finalizeSql(
  parsedQuery: ParsedQuery,
  trimmedSql: string
): ValidationResult {
  const limitResult = normalizeLimit(parsedQuery.query);
  if (limitResult.isErr()) {
    return Result.err(limitResult.error);
  }

  if (limitResult.value) {
    return Result.ok({
      changed: true,
      sql: formatStatement(parsedQuery.statement),
    });
  }

  return Result.ok({ changed: false, sql: trimmedSql });
}

function createNumericExpr(value: number): Expr {
  return {
    Value: {
      span: span(),
      value: { Number: [String(value), false] },
    },
  };
}

function createLimitClause(limitValue: number): LimitClause {
  return {
    LimitOffset: {
      limit: createNumericExpr(limitValue),
      limit_by: [],
      offset: undefined,
    },
  };
}

function getLimitExpr(limitClause: LimitClause): Expr | undefined {
  const limitOffset = limitClause.LimitOffset;
  if (limitOffset) {
    return limitOffset.limit;
  }

  const offsetComma = limitClause.OffsetCommaLimit;
  return offsetComma?.limit;
}

function setLimitExpr(limitClause: LimitClause, expr: Expr): void {
  const limitOffset = limitClause.LimitOffset;
  if (limitOffset) {
    limitOffset.limit = expr;
    return;
  }

  const offsetComma = limitClause.OffsetCommaLimit;
  if (offsetComma) {
    offsetComma.limit = expr;
  }
}

function normalizeFetchLimit(
  query: Query
): ResultType<boolean, SqlValidationError> {
  const fetch = query.fetch;
  if (!fetch) {
    return Result.ok(false);
  }

  const quantity = fetch.quantity;
  if (!quantity) {
    return invalid("limit_not_numeric", "LIMIT value must be numeric");
  }

  const fetchValue = getNumericValueFromExpr(quantity);
  if (fetchValue === null) {
    return invalid("limit_not_numeric", "LIMIT value must be numeric");
  }

  if (fetchValue <= MAX_LIMIT) {
    return Result.ok(false);
  }

  fetch.quantity = createNumericExpr(MAX_LIMIT);
  return Result.ok(true);
}

function normalizeLimitClause(
  query: Query
): ResultType<boolean, SqlValidationError> {
  const limitClause = query.limit_clause;
  if (!limitClause) {
    return Result.ok(false);
  }

  const limitExpr = getLimitExpr(limitClause);
  if (!limitExpr) {
    if (query.fetch) {
      return Result.ok(false);
    }

    setLimitExpr(limitClause, createNumericExpr(MAX_LIMIT));
    return Result.ok(true);
  }

  const limitValue = getNumericValueFromExpr(limitExpr);
  if (limitValue === null) {
    return invalid("limit_not_numeric", "LIMIT value must be numeric");
  }

  if (limitValue <= MAX_LIMIT) {
    return Result.ok(false);
  }

  setLimitExpr(limitClause, createNumericExpr(MAX_LIMIT));
  return Result.ok(true);
}

function normalizeLimit(query: Query): ResultType<boolean, SqlValidationError> {
  const fetchResult = normalizeFetchLimit(query);
  if (fetchResult.isErr()) {
    return fetchResult;
  }

  const limitResult = normalizeLimitClause(query);
  if (limitResult.isErr()) {
    return limitResult;
  }

  const hasLimit =
    Boolean(query.fetch) ||
    Boolean(query.limit_clause && getLimitExpr(query.limit_clause));
  if (!hasLimit) {
    query.limit_clause = createLimitClause(MAX_LIMIT);
    return Result.ok(true);
  }

  return Result.ok(fetchResult.value || limitResult.value);
}

function isReadOnlySetExpr(setExpr: SetExpr): boolean {
  if (setExpr.Select || setExpr.Values || setExpr.Table) {
    return true;
  }

  const nestedQuery = setExpr.Query;
  if (nestedQuery) {
    return isReadOnlyQuery(nestedQuery);
  }

  const setOperation = setExpr.SetOperation;
  if (!setOperation) {
    return false;
  }

  return (
    isReadOnlySetExpr(setOperation.left) &&
    isReadOnlySetExpr(setOperation.right)
  );
}

function isReadOnlyQuery(query: Query): boolean {
  const withClause = query.with;
  if (withClause) {
    for (const cte of withClause.cte_tables) {
      if (!isReadOnlyQuery(cte.query)) {
        return false;
      }
    }
  }

  return isReadOnlySetExpr(query.body);
}

function findCteViolation(query: Query): Violation | null {
  const withClause = query.with;
  if (!withClause) {
    return null;
  }

  for (const cte of withClause.cte_tables) {
    if (!isReadOnlyQuery(cte.query)) {
      return ERRORS.cteSelectOnly;
    }
  }

  return null;
}

function findSelectIntoViolationInSetExpr(
  setExpr: SetExpr,
  dbType: DatabaseCredentialProviderType
): Violation | null {
  const select = setExpr.Select;
  if (select) {
    return select.into ? getSelectIntoError(dbType) : null;
  }

  const nestedQuery = setExpr.Query;
  if (nestedQuery) {
    return findSelectIntoViolationInQuery(nestedQuery, dbType);
  }

  const setOperation = setExpr.SetOperation;
  if (!setOperation) {
    return null;
  }

  const leftViolation = findSelectIntoViolationInSetExpr(
    setOperation.left,
    dbType
  );
  if (leftViolation) {
    return leftViolation;
  }

  return findSelectIntoViolationInSetExpr(setOperation.right, dbType);
}

function findSelectIntoViolationInQuery(
  query: Query,
  dbType: DatabaseCredentialProviderType
): Violation | null {
  const bodyViolation = findSelectIntoViolationInSetExpr(query.body, dbType);
  if (bodyViolation) {
    return bodyViolation;
  }

  const withClause = query.with;
  if (!withClause) {
    return null;
  }

  for (const cte of withClause.cte_tables) {
    const cteViolation = findSelectIntoViolationInQuery(cte.query, dbType);
    if (cteViolation) {
      return cteViolation;
    }
  }

  return null;
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
  dbType: DatabaseCredentialProviderType
): Promise<ValidationResult> {
  return Result.gen(async function* validateReadOnlyQueryFlow() {
    const context = yield* buildContext(sql, dbType);
    yield* Result.await(initSqlParser());
    const statements = yield* Result.await(parseStatements(context));
    const parsedQuery = yield* extractParsedQuery(statements);
    yield* validateReadOnlyQuery(parsedQuery.query, context.dbType);
    return finalizeSql(parsedQuery, context.trimmedSql);
  });
}
