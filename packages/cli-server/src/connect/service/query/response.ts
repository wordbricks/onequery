import {
  buildCliSanitization,
  sanitizeCliRemoteText,
} from "../../../transport/sanitization";
import { QueryLogicalType } from "../../gen/onequery/cli/v1/query_pb";
import { buildCliSource } from "../source/response";
import type {
  ExecuteQueryColumnMessage,
  ExecuteQueryPayload,
  ExecuteQueryRowMessage,
  QuerySourceInit,
  ValidateQueryResponseInit,
} from "./types";

export function buildQueryValidateResponse(response: {
  request: {
    sql: string;
    parameters: readonly unknown[];
    maxRows: number;
    maxBytes: number;
    cellMaxChars: number;
    timeoutMs: number;
  };
  normalizedSql: string;
  declaredResultWindow: {
    maxRows: number;
    maxBytes: number;
    cellMaxChars: number;
    timeoutMs: number;
  };
  source: Parameters<typeof buildCliSource>[0];
  truncated: boolean;
}): ValidateQueryResponseInit {
  return {
    request: {
      sql: response.request.sql,
      parameters: [],
      maxRows: response.request.maxRows,
      maxBytes: response.request.maxBytes,
      cellMaxChars: response.request.cellMaxChars,
      timeoutMs: response.request.timeoutMs,
    },
    normalizedSql: response.normalizedSql,
    declaredResultWindow: {
      maxRows: response.declaredResultWindow.maxRows,
      maxBytes: response.declaredResultWindow.maxBytes,
      cellMaxChars: response.declaredResultWindow.cellMaxChars,
      timeoutMs: response.declaredResultWindow.timeoutMs,
    },
    source: buildQuerySource(response.source),
    truncated: response.truncated,
  };
}

export function buildQueryExecuteResponse(response: {
  columns: readonly { name: string; logicalType: string | null }[];
  elapsedMs: number;
  rowCount: number;
  rows: readonly (readonly string[])[];
  source: Parameters<typeof buildCliSource>[0];
  truncated: boolean;
}): ExecuteQueryPayload {
  return {
    source: buildQuerySource(response.source),
    rowCount: BigInt(response.rowCount),
    elapsedMs: BigInt(response.elapsedMs),
    columns: response.columns.map(buildCliQueryColumn),
    rows: response.rows.map(buildCliQueryRow),
    truncated: response.truncated,
  };
}

export function sanitizeQueryExecuteResponse(
  data: ExecuteQueryPayload
): ExecuteQueryPayload {
  return {
    ...data,
    columns: data.columns.map((column) => ({
      ...column,
      name: sanitizeCliRemoteText(column.name),
    })),
    rows: data.rows.map((row) => ({
      ...row,
      values: row.values.map(sanitizeCliRemoteText),
    })),
  };
}

export function buildQueryExecuteSanitization(hasRows: boolean) {
  return buildCliSanitization(
    hasRows
      ? ["$.columns[*].name", "$.rows[*].values[*]"]
      : ["$.columns[*].name"]
  );
}

function buildQuerySource(
  source: Parameters<typeof buildCliSource>[0]
): QuerySourceInit {
  const cliSource = buildCliSource(source);

  return {
    provider: cliSource.provider,
    queryable: cliSource.queryable,
    sourceKey: cliSource.sourceKey,
    status: cliSource.status,
    ...(cliSource.displayName ? { displayName: cliSource.displayName } : {}),
  };
}

function buildCliQueryColumn(column: {
  name: string;
  logicalType: string | null;
}): ExecuteQueryColumnMessage {
  return {
    name: column.name,
    ...(column.logicalType
      ? { logicalType: toCliQueryLogicalType(column.logicalType) }
      : {}),
  };
}

function buildCliQueryRow(row: readonly string[]): ExecuteQueryRowMessage {
  return {
    values: [...row],
  };
}

function toCliQueryLogicalType(value: string) {
  switch (value) {
    case "string":
      return QueryLogicalType.STRING;
    case "number":
      return QueryLogicalType.NUMBER;
    case "boolean":
      return QueryLogicalType.BOOLEAN;
    case "bigint":
      return QueryLogicalType.BIGINT;
    case "datetime":
      return QueryLogicalType.DATETIME;
    case "array":
      return QueryLogicalType.ARRAY;
    case "json":
      return QueryLogicalType.JSON;
    default:
      return undefined;
  }
}
