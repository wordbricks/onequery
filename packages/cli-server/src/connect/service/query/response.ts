import { durationFromMs } from "@bufbuild/protobuf/wkt";

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
      timeout: durationFromMs(response.request.timeoutMs),
    },
    normalizedSql: response.normalizedSql,
    declaredResultWindow: {
      maxRows: response.declaredResultWindow.maxRows,
      maxBytes: response.declaredResultWindow.maxBytes,
      cellMaxChars: response.declaredResultWindow.cellMaxChars,
      timeout: durationFromMs(response.declaredResultWindow.timeoutMs),
    },
    source: buildCliSource(response.source),
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
    source: buildCliSource(response.source),
    rowCount: response.rowCount,
    elapsed: durationFromMs(response.elapsedMs),
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
      displayValues: row.displayValues.map(sanitizeCliRemoteText),
    })),
  };
}

export function buildQueryExecuteSanitization(hasRows: boolean) {
  return buildCliSanitization(
    hasRows
      ? ["$.columns[*].name", "$.rows[*].displayValues[*]"]
      : ["$.columns[*].name"]
  );
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
    displayValues: [...row],
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
