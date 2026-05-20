import type { DatabaseCredentialProviderType } from "@onequery/db/server";
import {
  Dialect,
  generate,
  init as initPolyglot,
  parse,
} from "@polyglot-sql/sdk";
import type * as PolyglotSdk from "@polyglot-sql/sdk";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

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
  aws_athena_connector: Dialect.Athena,
  bigquery: Dialect.BigQuery,
  laminar: Dialect.ClickHouse,
  mysql: Dialect.MySQL,
  postgres: Dialect.PostgreSQL,
} as const satisfies Record<DatabaseCredentialProviderType, Dialect>;

type ValidationContext = {
  trimmedSql: string;
  dbType: DatabaseCredentialProviderType;
  dialect: (typeof DIALECT_MAP)[DatabaseCredentialProviderType];
};

type ParsedQuery = {
  statement: Expression;
};

type Expression = PolyglotSdk.ast.Expression;
type ExpressionRecord = Record<string, unknown>;

type SelectData = ExpressionRecord & {
  fetch?: FetchData | null;
  into?: unknown;
  limit?: LimitData | null;
  with?: WithData | null;
};

type SetOperationData = ExpressionRecord & {
  left?: Expression;
  limit?: Expression | null;
  right?: Expression;
  with?: WithData | null;
};

type SubqueryData = ExpressionRecord & {
  this?: Expression;
};

type WithData = ExpressionRecord & {
  ctes?: CteData[];
};

type CteData = ExpressionRecord & {
  this?: Expression;
};

type LimitData = ExpressionRecord & {
  this?: Expression;
};

type FetchData = ExpressionRecord & {
  count?: Expression | null;
};

type LiteralData = ExpressionRecord & {
  literal_type?: unknown;
  value?: unknown;
};

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

  if (!isTopLevelQueryExpression(statement)) {
    const kind = getExpressionKind(statement);
    return invalid(
      "non_select_query",
      `Only SELECT queries are allowed. Got: ${kind ?? "unknown"}`
    );
  }

  return Result.ok({ statement });
}

function validateReadOnlyQuery(
  query: Expression,
  dbType: DatabaseCredentialProviderType
): ResultType<Expression, SqlValidationError> {
  const cteViolation = findCteViolation(query);
  if (cteViolation) {
    return invalid("cte_must_select", cteViolation);
  }

  const selectIntoViolation = findSelectIntoViolationInQuery(query, dbType);
  if (selectIntoViolation) {
    return invalid("select_into_not_allowed", selectIntoViolation);
  }

  if (!isReadOnlyQueryExpression(query)) {
    return invalid("non_select_query", "Only SELECT queries are allowed.");
  }

  return Result.ok(query);
}

function finalizeSql(
  parsedQuery: ParsedQuery,
  context: ValidationContext
): ValidationResult {
  const limitResult = normalizeLimit(parsedQuery.statement);
  if (limitResult.isErr()) {
    return Result.err(limitResult.error);
  }

  if (limitResult.value) {
    return Result.try({
      try: () => ({
        changed: true,
        sql: generateSql(parsedQuery.statement, context.dialect),
      }),
      catch: (cause) =>
        new SqlValidationError({
          cause,
          message: `Failed to generate SQL: ${toErrorMessage(cause)}`,
          reason: "parse_failed",
        }),
    });
  }

  return Result.ok({ changed: false, sql: context.trimmedSql });
}

function createNumericExpr(value: number): Expression {
  return {
    literal: {
      literal_type: "number",
      value: String(value),
    },
  };
}

function createLimitClause(limitValue: number): LimitData {
  return {
    comments: [],
    percent: false,
    this: createNumericExpr(limitValue),
  };
}

function getNumericValueFromExpr(expr: Expression | undefined): number | null {
  const literal = getExpressionData<LiteralData>(expr, "literal");
  if (!literal || literal.literal_type !== "number") {
    return null;
  }

  const raw = literal.value;
  if (typeof raw !== "string") {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeFetchLimit(
  select: SelectData
): ResultType<boolean, SqlValidationError> {
  const fetch = select.fetch;
  if (!fetch) {
    return Result.ok(false);
  }

  const count = fetch.count ?? undefined;
  if (!count) {
    return invalid("limit_not_numeric", "LIMIT value must be numeric");
  }

  const fetchValue = getNumericValueFromExpr(count);
  if (fetchValue === null) {
    return invalid("limit_not_numeric", "LIMIT value must be numeric");
  }

  if (fetchValue <= MAX_LIMIT) {
    return Result.ok(false);
  }

  fetch.count = createNumericExpr(MAX_LIMIT);
  return Result.ok(true);
}

function normalizeLimitClause(
  select: SelectData
): ResultType<boolean, SqlValidationError> {
  const limitClause = select.limit;
  if (!limitClause) {
    return Result.ok(false);
  }

  const limitExpr = limitClause.this;
  if (!limitExpr) {
    if (select.fetch) {
      return Result.ok(false);
    }

    limitClause.this = createNumericExpr(MAX_LIMIT);
    return Result.ok(true);
  }

  const limitValue = getNumericValueFromExpr(limitExpr);
  if (limitValue === null) {
    return invalid("limit_not_numeric", "LIMIT value must be numeric");
  }

  if (limitValue <= MAX_LIMIT) {
    return Result.ok(false);
  }

  limitClause.this = createNumericExpr(MAX_LIMIT);
  return Result.ok(true);
}

function normalizeSelectLimit(
  select: SelectData
): ResultType<boolean, SqlValidationError> {
  const fetchResult = normalizeFetchLimit(select);
  if (fetchResult.isErr()) {
    return fetchResult;
  }

  const limitResult = normalizeLimitClause(select);
  if (limitResult.isErr()) {
    return limitResult;
  }

  const hasLimit = Boolean(select.fetch) || Boolean(select.limit?.this);
  if (!hasLimit) {
    select.limit = createLimitClause(MAX_LIMIT);
    return Result.ok(true);
  }

  return Result.ok(fetchResult.value || limitResult.value);
}

function normalizeSetOperationLimit(
  setOperation: SetOperationData
): ResultType<boolean, SqlValidationError> {
  const limitExpr = setOperation.limit ?? undefined;
  if (!limitExpr) {
    setOperation.limit = createNumericExpr(MAX_LIMIT);
    return Result.ok(true);
  }

  const limitValue = getNumericValueFromExpr(limitExpr);
  if (limitValue === null) {
    return invalid("limit_not_numeric", "LIMIT value must be numeric");
  }

  if (limitValue <= MAX_LIMIT) {
    return Result.ok(false);
  }

  setOperation.limit = createNumericExpr(MAX_LIMIT);
  return Result.ok(true);
}

function normalizeLimit(
  statement: Expression
): ResultType<boolean, SqlValidationError> {
  const select = getExpressionData<SelectData>(statement, "select");
  if (select) {
    return normalizeSelectLimit(select);
  }

  const setOperation = getSetOperationData(statement);
  if (setOperation) {
    return normalizeSetOperationLimit(setOperation);
  }

  return Result.ok(false);
}

function isExpression(value: unknown): value is Expression {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value).length === 1;
}

function getExpressionKind(expr: Expression | undefined): string | null {
  if (!isExpression(expr)) {
    return null;
  }

  return Object.keys(expr)[0] ?? null;
}

function getExpressionData<T extends ExpressionRecord>(
  expr: Expression | undefined,
  kind: string
): T | null {
  if (!isExpression(expr) || !(kind in expr)) {
    return null;
  }

  const data = (expr as ExpressionRecord)[kind];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  return data as T;
}

function getSetOperationData(expr: Expression): SetOperationData | null {
  return (
    getExpressionData<SetOperationData>(expr, "union") ??
    getExpressionData<SetOperationData>(expr, "intersect") ??
    getExpressionData<SetOperationData>(expr, "except")
  );
}

function getWithClause(expr: Expression): WithData | null {
  const select = getExpressionData<SelectData>(expr, "select");
  if (select?.with) {
    return select.with;
  }

  const setOperation = getSetOperationData(expr);
  return setOperation?.with ?? null;
}

function getCtes(expr: Expression): CteData[] {
  const ctes = getWithClause(expr)?.ctes;
  return Array.isArray(ctes) ? ctes : [];
}

function isTopLevelQueryExpression(expr: Expression): boolean {
  const kind = getExpressionKind(expr);
  return (
    kind === "select" ||
    kind === "union" ||
    kind === "intersect" ||
    kind === "except"
  );
}

function areCtesReadOnly(expr: Expression): boolean {
  for (const cte of getCtes(expr)) {
    if (!isExpression(cte.this) || !isReadOnlyQueryExpression(cte.this)) {
      return false;
    }
  }

  return true;
}

function isReadOnlyQueryExpression(expr: Expression): boolean {
  if (!areCtesReadOnly(expr)) {
    return false;
  }

  const select = getExpressionData<SelectData>(expr, "select");
  if (select) {
    return true;
  }

  const setOperation = getSetOperationData(expr);
  if (setOperation) {
    return (
      isExpression(setOperation.left) &&
      isReadOnlyQueryExpression(setOperation.left) &&
      isExpression(setOperation.right) &&
      isReadOnlyQueryExpression(setOperation.right)
    );
  }

  const subquery = getExpressionData<SubqueryData>(expr, "subquery");
  if (subquery?.this && isExpression(subquery.this)) {
    return isReadOnlyQueryExpression(subquery.this);
  }

  return (
    getExpressionKind(expr) === "values" || getExpressionKind(expr) === "table"
  );
}

function findCteViolation(query: Expression): Violation | null {
  for (const cte of getCtes(query)) {
    if (!isExpression(cte.this) || !isReadOnlyQueryExpression(cte.this)) {
      return ERRORS.cteSelectOnly;
    }

    const nestedViolation = findCteViolation(cte.this);
    if (nestedViolation) {
      return nestedViolation;
    }
  }

  const setOperation = getSetOperationData(query);
  if (setOperation) {
    if (setOperation.left) {
      const leftViolation = findCteViolation(setOperation.left);
      if (leftViolation) {
        return leftViolation;
      }
    }

    if (setOperation.right) {
      return findCteViolation(setOperation.right);
    }
  }

  const subquery = getExpressionData<SubqueryData>(query, "subquery");
  if (subquery?.this) {
    return findCteViolation(subquery.this);
  }

  return null;
}

function findSelectIntoViolationInQuery(
  query: Expression,
  dbType: DatabaseCredentialProviderType
): Violation | null {
  const select = getExpressionData<SelectData>(query, "select");
  if (select?.into) {
    return getSelectIntoError(dbType);
  }

  for (const cte of getCtes(query)) {
    if (cte.this) {
      const cteViolation = findSelectIntoViolationInQuery(cte.this, dbType);
      if (cteViolation) {
        return cteViolation;
      }
    }
  }

  const setOperation = getSetOperationData(query);
  if (setOperation) {
    if (setOperation.left) {
      const leftViolation = findSelectIntoViolationInQuery(
        setOperation.left,
        dbType
      );
      if (leftViolation) {
        return leftViolation;
      }
    }

    if (setOperation.right) {
      return findSelectIntoViolationInQuery(setOperation.right, dbType);
    }
  }

  const subquery = getExpressionData<SubqueryData>(query, "subquery");
  if (subquery?.this) {
    return findSelectIntoViolationInQuery(subquery.this, dbType);
  }

  return null;
}

function generateSql(statement: Expression, dialect: Dialect): string {
  const generated = generate([statement], dialect);
  const sql = generated.sql?.[0];
  if (!generated.success || !sql) {
    throw new Error(generated.error ?? "unknown generator error");
  }

  return sql;
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
    yield* validateReadOnlyQuery(parsedQuery.statement, context.dbType);
    return finalizeSql(parsedQuery, context);
  });
}
