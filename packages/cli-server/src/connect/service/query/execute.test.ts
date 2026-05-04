import { describe, expect, it } from "vitest";

import { encodePageCursor } from "../../../read-controls-policy";
import { selectQueryResponseRows } from "./execute";

describe("selectQueryResponseRows", () => {
  it("returns a normal cursor page when allPages is false", () => {
    expect(
      selectQueryResponseRows({
        allPages: false,
        readControls: { limit: 2, offset: 1 },
        rows: ["a", "b", "c", "d"],
      })
    ).toEqual({
      items: ["b", "c"],
      page: {
        nextCursor: encodePageCursor(3),
        returnedCount: 2,
      },
    });
  });

  it("returns every remaining row without a follow-up cursor when allPages is true", () => {
    expect(
      selectQueryResponseRows({
        allPages: true,
        readControls: { limit: 2, offset: 1 },
        rows: ["a", "b", "c", "d"],
      })
    ).toEqual({
      items: ["b", "c", "d"],
      page: {
        nextCursor: null,
        returnedCount: 3,
      },
    });
  });
});
