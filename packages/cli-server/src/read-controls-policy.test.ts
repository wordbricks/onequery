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

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toEqual(new Set(["sources.name", "sources.status"]));
  });

  it("rejects unsupported selected fields", () => {
    const result = parseSelectedFields("sources.provider", ["sources.name"]);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected selected fields parsing to fail");
    }

    expect(result.error.message).toBe(
      'unsupported field selection "sources.provider"'
    );
  });

  it("round-trips page cursors", () => {
    const cursor = encodePageCursor(25);

    const result = parsePageCursor(cursor);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toBe(25);
  });

  it("rejects invalid page cursors", () => {
    const result = parsePageCursor("not-a-cursor");
    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected cursor parsing to fail");
    }

    expect(result.error.message).toBe("cursor is invalid");
  });

  it("paginates from the decoded offset", () => {
    const page = paginateItems(["a", "b", "c", "d"], {
      limit: 2,
      offset: 2,
    });

    expect(page).toEqual({
      items: ["c", "d"],
      page: {
        nextCursor: null,
        returnedCount: 2,
      },
    });
  });
});
