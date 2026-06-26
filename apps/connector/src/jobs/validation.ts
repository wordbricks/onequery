import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CALL|UNLOAD|COPY|MSCK|VACUUM|ANALYZE|OPTIMIZE)\b/i;
const FORBIDDEN_EXPLAIN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CALL|UNLOAD|COPY|MSCK|VACUUM|OPTIMIZE)\b/i;
const READ_ONLY_KEYWORD_ERROR =
  "Only SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN queries are allowed";
const READ_ONLY_FIRST_KEYWORDS = new Set([
  "SELECT",
  "WITH",
  "SHOW",
  "DESCRIBE",
  "DESC",
  "EXPLAIN",
]);

class SqlValidationError extends TaggedError("SqlValidationError")<{
  code: "INVALID_QUERY";
  message: string;
}>() {
  constructor(message: string) {
    super({
      code: "INVALID_QUERY",
      message,
    });
  }
}

export function validateAthenaSql(
  sql: string
): ResultType<{ sql: string }, SqlValidationError> {
  const trimmed = sql.trim();
  if (!trimmed) {
    return invalid("Query cannot be empty");
  }

  const normalized = stripCommentsAndStrings(trimmed);
  if (hasMultipleStatements(normalized)) {
    return invalid("Multiple statements are not allowed");
  }

  const firstKeyword = readFirstKeyword(normalized);
  if (!READ_ONLY_FIRST_KEYWORDS.has(firstKeyword)) {
    return invalid(READ_ONLY_KEYWORD_ERROR);
  }

  if (firstKeyword === "WITH" && !/\bSELECT\b/i.test(normalized)) {
    return invalid("WITH queries must eventually select rows");
  }

  const forbiddenKeywords =
    firstKeyword === "EXPLAIN"
      ? FORBIDDEN_EXPLAIN_KEYWORDS
      : FORBIDDEN_KEYWORDS;

  if (firstKeyword !== "SHOW" && forbiddenKeywords.test(normalized)) {
    return invalid("Query contains non-read operations");
  }

  if (firstKeyword === "EXPLAIN" && !/\bSELECT\b/i.test(normalized)) {
    return invalid("EXPLAIN queries must explain SELECT statements");
  }

  return Result.ok({
    sql: trimmed,
  });
}

function invalid(message: string): ResultType<never, SqlValidationError> {
  return Result.err(new SqlValidationError(message));
}

function hasMultipleStatements(sql: string): boolean {
  const firstSemicolonIndex = sql.indexOf(";");
  if (firstSemicolonIndex === -1) {
    return false;
  }

  const remaining = sql.slice(firstSemicolonIndex + 1);
  return remaining.trim().length > 0;
}

function readFirstKeyword(sql: string): string {
  const match = /^[\s(]*([a-zA-Z_]+)/.exec(sql);
  if (!match?.[1]) {
    return "";
  }

  return match[1].toUpperCase();
}

function stripCommentsAndStrings(input: string): string {
  let output = "";
  let index = 0;

  while (index < input.length) {
    const current = input[index];
    const next = input[index + 1];

    if (current === "-" && next === "-") {
      index += 2;
      output += "  ";
      while (index < input.length && input[index] !== "\n") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      output += "  ";
      while (index < input.length) {
        const blockCurrent = input[index];
        const blockNext = input[index + 1];
        if (blockCurrent === "*" && blockNext === "/") {
          output += "  ";
          index += 2;
          break;
        }
        output += blockCurrent === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    if (current === "'" || current === '"' || current === "`") {
      const quote = current;
      output += " ";
      index += 1;
      while (index < input.length) {
        const char = input[index];
        output += char === "\n" ? "\n" : " ";
        index += 1;

        if (char === quote) {
          const escapedByDoubleQuote = input[index] === quote;
          if (escapedByDoubleQuote) {
            output += " ";
            index += 1;
            continue;
          }
          break;
        }

        if (char === "\\" && index < input.length) {
          output += input[index] === "\n" ? "\n" : " ";
          index += 1;
        }
      }
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
}
