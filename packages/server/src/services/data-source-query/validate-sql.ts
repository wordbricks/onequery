import type {
  Expr,
  LimitClause,
  Query,
  SetExpr,
  Statement,
} from "@casual-simulation/sql-parser";
import type { Result } from "@onequery/base";
import type { DatabaseCredentialProviderType } from "@onequery/db/server";

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

type ValidationResult = Result<ValidationValue, string>;

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
): Result<ValidationContext, string> {
  const trimmedSql = sql.trim();
  if (!trimmedSql) {
    return { error: "Query cannot be empty", ok: false };
  }

  if (dbType === "mysql" && OUTFILE_PATTERN.test(trimmedSql)) {
    return { error: OUTFILE_ERROR, ok: false };
  }

  return {
    ok: true,
    value: {
      dbType,
      dialect: DIALECT_MAP[dbType],
      trimmedSql,
    },
  };
}

async function initSqlParser(): Promise<Result<null, string>> {
  return ensureSqlParserInit()
    .then(() => ({ ok: true as const, value: null }))
    .catch((error: unknown) => ({
      error: `Failed to initialize SQL parser: ${toErrorMessage(error)}`,
      ok: false as const,
    }));
}

async function parseStatements(
  context: ValidationContext
): Promise<Result<Statement[], string>> {
  return Promise.resolve()
    .then(() => parseSqlStatements(context.trimmedSql, context.dialect))
    .then((statements) => ({ ok: true as const, value: statements }))
    .catch((error: unknown) => ({
      error: `Failed to parse SQL: ${toErrorMessage(error)}`,
      ok: false as const,
    }));
}

function extractParsedQuery(
  statements: Statement[]
): Result<ParsedQuery, string> {
  if (statements.length !== 1) {
    return { error: "Multiple statements are not allowed", ok: false };
  }

  const statement = statements[0];
  if (!statement) {
    return { error: "Failed to parse SQL: invalid AST", ok: false };
  }

  const query = statement.Query;
  if (!query) {
    const kind = getStatementKind(statement);
    return {
      error: `Only SELECT queries are allowed. Got: ${kind?.toLowerCase() ?? "unknown"}`,
      ok: false,
    };
  }

  return { ok: true, value: { query, statement } };
}

function validateReadOnlyQuery(
  query: Query,
  dbType: DatabaseCredentialProviderType
): Result<Query, string> {
  const cteViolation = findCteViolation(query);
  if (cteViolation) {
    return { error: cteViolation, ok: false };
  }

  const selectIntoViolation = findSelectIntoViolationInQuery(query, dbType);
  if (selectIntoViolation) {
    return { error: selectIntoViolation, ok: false };
  }

  if (!isReadOnlyQuery(query)) {
    return { error: "Only SELECT queries are allowed.", ok: false };
  }

  return { ok: true, value: query };
}

function finalizeSql(
  parsedQuery: ParsedQuery,
  trimmedSql: string
): ValidationResult {
  const limitResult = normalizeLimit(parsedQuery.query);
  if (limitResult.error) {
    return { error: limitResult.error, ok: false };
  }

  if (limitResult.changed) {
    return {
      ok: true,
      value: { changed: true, sql: formatStatement(parsedQuery.statement) },
    };
  }

  return { ok: true, value: { changed: false, sql: trimmedSql } };
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

function normalizeFetchLimit(query: Query): {
  changed: boolean;
  error?: string;
} {
  const fetch = query.fetch;
  if (!fetch) {
    return { changed: false };
  }

  const quantity = fetch.quantity;
  if (!quantity) {
    return { changed: false, error: "LIMIT value must be numeric" };
  }

  const fetchValue = getNumericValueFromExpr(quantity);
  if (fetchValue === null) {
    return { changed: false, error: "LIMIT value must be numeric" };
  }

  if (fetchValue <= MAX_LIMIT) {
    return { changed: false };
  }

  fetch.quantity = createNumericExpr(MAX_LIMIT);
  return { changed: true };
}

function normalizeLimitClause(query: Query): {
  changed: boolean;
  error?: string;
} {
  const limitClause = query.limit_clause;
  if (!limitClause) {
    return { changed: false };
  }

  const limitExpr = getLimitExpr(limitClause);
  if (!limitExpr) {
    if (query.fetch) {
      return { changed: false };
    }

    setLimitExpr(limitClause, createNumericExpr(MAX_LIMIT));
    return { changed: true };
  }

  const limitValue = getNumericValueFromExpr(limitExpr);
  if (limitValue === null) {
    return { changed: false, error: "LIMIT value must be numeric" };
  }

  if (limitValue <= MAX_LIMIT) {
    return { changed: false };
  }

  setLimitExpr(limitClause, createNumericExpr(MAX_LIMIT));
  return { changed: true };
}

function normalizeLimit(query: Query): { changed: boolean; error?: string } {
  const fetchResult = normalizeFetchLimit(query);
  if (fetchResult.error) {
    return fetchResult;
  }

  const limitResult = normalizeLimitClause(query);
  if (limitResult.error) {
    return limitResult;
  }

  const hasLimit =
    Boolean(query.fetch) ||
    Boolean(query.limit_clause && getLimitExpr(query.limit_clause));
  if (!hasLimit) {
    query.limit_clause = createLimitClause(MAX_LIMIT);
    return { changed: true };
  }

  return { changed: fetchResult.changed || limitResult.changed };
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

export async function validateAndNormalizeReadOnlyQuery(
  sql: string,
  dbType: DatabaseCredentialProviderType
): Promise<ValidationResult> {
  const contextResult = buildContext(sql, dbType);
  if (!contextResult.ok) {
    return { error: contextResult.error, ok: false };
  }

  const initResult = await initSqlParser();
  if (!initResult.ok) {
    return { error: initResult.error, ok: false };
  }

  const parseResult = await parseStatements(contextResult.value);
  if (!parseResult.ok) {
    return { error: parseResult.error, ok: false };
  }

  const parsedQueryResult = extractParsedQuery(parseResult.value);
  if (!parsedQueryResult.ok) {
    return { error: parsedQueryResult.error, ok: false };
  }

  const readOnlyResult = validateReadOnlyQuery(
    parsedQueryResult.value.query,
    contextResult.value.dbType
  );
  if (!readOnlyResult.ok) {
    return { error: readOnlyResult.error, ok: false };
  }

  return finalizeSql(parsedQueryResult.value, contextResult.value.trimmedSql);
}
