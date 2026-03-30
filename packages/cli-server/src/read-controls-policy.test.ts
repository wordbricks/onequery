import { describe, expect, it } from "vitest";

import {
  encodePageCursor,
  paginateItems,
  parsePageCursor,
  parseSelectedFields,
} from "./read-controls-policy";

describe("read controls policy", () => {
  it("deduplicates selected fields while preserving validity", () => {
    const result = parseSelectedFields(
      "sources.name, sources.name, sources.status",
      ["sources.name", "sources.status"]
    );

    expect(result).toEqual({
      ok: true,
      value: new Set(["sources.name", "sources.status"]),
    });
  });

  it("rejects unsupported selected fields", () => {
    const result = parseSelectedFields("sources.provider", ["sources.name"]);

    expect(result).toEqual({
      message: 'unsupported field selection "sources.provider"',
      ok: false,
    });
  });

  it("round-trips page cursors", () => {
    const cursor = encodePageCursor(25);

    expect(parsePageCursor(cursor)).toEqual({
      ok: true,
      value: 25,
    });
  });

  it("rejects invalid page cursors", () => {
    expect(parsePageCursor("not-a-cursor")).toEqual({
      message: "cursor is invalid",
      ok: false,
    });
  });

  it("paginates from the decoded offset", () => {
    const page = paginateItems(["a", "b", "c", "d"], {
      limit: 2,
      offset: 2,
    });

    expect(page).toEqual({
      items: ["c", "d"],
      page: {
        hasMore: false,
        nextCursor: null,
        returned: 2,
      },
    });
  });
});
