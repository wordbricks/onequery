import { create, isFieldSet } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  CLI_DEFAULT_PAGE_LIMIT,
  encodePageCursor,
} from "../../read-controls-policy";
import { CliPageRequestSchema } from "../gen/onequery/cli/v1/common_pb";
import { parseCliPageRequest } from "./read-controls";

describe("parseCliPageRequest", () => {
  it("defaults the page limit when the request omits pagination", () => {
    const result = parseCliPageRequest(undefined);

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

    const result = parseCliPageRequest(request);

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

    const result = parseCliPageRequest(request);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual({
      limit: 25,
      offset: 10,
    });
  });
});
