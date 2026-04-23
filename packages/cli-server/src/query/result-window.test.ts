import { describe, expect, it } from "vitest";

import { applyQueryResultWindow } from "./result-window";

const textEncoder = new TextEncoder();

describe("applyQueryResultWindow", () => {
  it("keeps the first row aligned with the declared columns when bytes are tight", () => {
    const result = applyQueryResultWindow({
      cellMaxChars: 512,
      maxBytes: 80,
      maxRows: 10,
      rows: [["1", "Ada Lovelace", "x".repeat(512)]],
    });

    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toHaveLength(3);
    expect(result.rows[0]).toEqual([
      "1",
      "Ada Lovelace",
      expect.stringMatching(/\.{3}$/),
    ]);
    expect(
      textEncoder.encode(JSON.stringify(result.rows[0] ?? [])).length
    ).toBeLessThanOrEqual(80);
  });

  it("uses empty strings as the shape-preserving lower bound for clipped cells", () => {
    const result = applyQueryResultWindow({
      cellMaxChars: 32,
      maxBytes: 10,
      maxRows: 10,
      rows: [["abcdef", "ghijkl", "mnopqr"]],
    });

    expect(result).toEqual({
      rows: [["", "", ""]],
      truncated: true,
    });
  });

  it("drops a row only when even an all-empty rectangular preview cannot fit", () => {
    const result = applyQueryResultWindow({
      cellMaxChars: 32,
      maxBytes: 10,
      maxRows: 10,
      rows: [["a", "b", "c", "d"]],
    });

    expect(result).toEqual({
      rows: [],
      truncated: true,
    });
  });
});
