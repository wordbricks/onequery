import { create, isFieldSet } from "@bufbuild/protobuf";
import { durationFromMs } from "@bufbuild/protobuf/wkt";
import { CliQueryRequestSchema } from "@onequery/proto-cli/cli/v1/query_pb";
import { describe, expect, it } from "vitest";

import { parseCliQueryRequest } from "./request";

describe("parseCliQueryRequest", () => {
  it("treats absent edition scalars as omitted query overrides", () => {
    const request = create(CliQueryRequestSchema, {
      sql: "select 1",
    });

    expect(request.maxRows).toBe(0);
    expect(request.maxBytes).toBe(0);
    expect(request.cellMaxChars).toBe(0);
    expect(request.timeout).toBeUndefined();
    expect(isFieldSet(request, CliQueryRequestSchema.field.maxRows)).toBe(
      false
    );
    expect(isFieldSet(request, CliQueryRequestSchema.field.maxBytes)).toBe(
      false
    );
    expect(isFieldSet(request, CliQueryRequestSchema.field.cellMaxChars)).toBe(
      false
    );
    expect(isFieldSet(request, CliQueryRequestSchema.field.timeout)).toBe(
      false
    );

    expect(parseCliQueryRequest(request)).toEqual({
      sql: "select 1",
    });
  });

  it("preserves explicit query overrides when fields are present", () => {
    const request = create(CliQueryRequestSchema, {
      sql: "select 1",
      cellMaxChars: 256,
      maxBytes: 4096,
      maxRows: 50,
      timeout: durationFromMs(2_500),
    });

    expect(isFieldSet(request, CliQueryRequestSchema.field.maxRows)).toBe(true);
    expect(isFieldSet(request, CliQueryRequestSchema.field.maxBytes)).toBe(
      true
    );
    expect(isFieldSet(request, CliQueryRequestSchema.field.cellMaxChars)).toBe(
      true
    );
    expect(isFieldSet(request, CliQueryRequestSchema.field.timeout)).toBe(true);

    expect(parseCliQueryRequest(request)).toEqual({
      sql: "select 1",
      cellMaxChars: 256,
      maxBytes: 4096,
      maxRows: 50,
      timeoutMs: 2_500,
    });
  });
});
