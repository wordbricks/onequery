import { isFieldSet } from "@bufbuild/protobuf";

import { CliQueryRequestSchema } from "../../gen/onequery/cli/v1/query_pb";
import type { CliQueryRequest } from "../../gen/onequery/cli/v1/query_pb";

export function parseCliQueryRequest(query: CliQueryRequest) {
  // Comment: editions track scalar presence, but Protobuf-ES still exposes the
  // default JS value on direct property reads. Preserve the CLI contract that
  // omitted bounds mean "use server defaults" with `isFieldSet()`.
  const cellMaxChars = isFieldSet(
    query,
    CliQueryRequestSchema.field.cellMaxChars
  )
    ? query.cellMaxChars
    : undefined;
  const maxBytes = isFieldSet(query, CliQueryRequestSchema.field.maxBytes)
    ? query.maxBytes
    : undefined;
  const maxRows = isFieldSet(query, CliQueryRequestSchema.field.maxRows)
    ? query.maxRows
    : undefined;
  const timeoutMs = isFieldSet(query, CliQueryRequestSchema.field.timeoutMs)
    ? query.timeoutMs
    : undefined;

  return {
    sql: query.sql,
    ...(cellMaxChars !== undefined ? { cellMaxChars } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    ...(maxRows !== undefined ? { maxRows } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}
