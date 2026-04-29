import { create, isFieldSet } from "@bufbuild/protobuf";
import { CliPageRequestSchema } from "@onequery/proto-cli/cli/v1/common_pb";
import { describe, expect, it } from "vitest";

import {
  CLI_DEFAULT_PAGE_LIMIT,
  encodePageCursor,
} from "../../read-controls-policy";
import { parseCliPageRequest } from "./read-controls";

describe("parseCliPageRequest", () => {
  it("defaults the page limit when the request omits pagination", () => {
    const result = parseCliPageRequest({
      invalidRequestKey: "READ_QUERY_INPUT_INVALID",
      page: undefined,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      limit: CLI_DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
  });

  it("defaults the page limit when edition field presence marks page fields absent", () => {
    const request = create(CliPageRequestSchema);

    expect(request.limit).toBe(0);
    expect(request.cursor).toBe("");
    expect(isFieldSet(request, CliPageRequestSchema.field.limit)).toBe(false);
    expect(isFieldSet(request, CliPageRequestSchema.field.cursor)).toBe(false);

    const result = parseCliPageRequest({
      invalidRequestKey: "READ_QUERY_INPUT_INVALID",
      page: request,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      limit: CLI_DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
  });

  it("preserves explicit pagination fields when they are present", () => {
    const request = create(CliPageRequestSchema, {
      cursor: encodePageCursor(10),
      limit: 25,
    });

    expect(isFieldSet(request, CliPageRequestSchema.field.limit)).toBe(true);
    expect(isFieldSet(request, CliPageRequestSchema.field.cursor)).toBe(true);

    const result = parseCliPageRequest({
      invalidRequestKey: "READ_QUERY_INPUT_INVALID",
      page: request,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      limit: 25,
      offset: 10,
    });
  });

  it("uses the caller-selected invalid request key for malformed cursors", () => {
    const request = create(CliPageRequestSchema, {
      cursor: "not-a-cursor",
    });

    const result = parseCliPageRequest({
      invalidRequestKey: "SOURCE_REQUEST_INVALID",
      page: request,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected malformed cursor to fail");
    }

    expect(result.error.reason).toBe("SOURCE_REQUEST_INVALID");
  });
});
