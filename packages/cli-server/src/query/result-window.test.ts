import { describe, expect, it } from "vitest";

import {
  applyQueryResultWindow,
  resolveQueryResultWindow,
} from "./result-window";

const textEncoder = new TextEncoder();
const rowsByteLength = (rows: readonly (readonly string[])[]) =>
  textEncoder.encode(JSON.stringify(rows)).length;

describe("applyQueryResultWindow", () => {
  it("treats zero-valued protobuf query bounds as omitted and restores defaults", () => {
    expect(
      resolveQueryResultWindow({
        cellMaxChars: 0,
        maxBytes: 0,
        maxRows: 0,
        timeoutMs: 0,
      })
    ).toEqual({
      cellMaxChars: 2000,
      maxBytes: 1_048_576,
      maxRows: 100,
      timeoutMs: 30_000,
    });
  });

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
    expect(rowsByteLength(result.rows)).toBeLessThanOrEqual(80);
  });

  it("uses empty strings as the shape-preserving lower bound for clipped cells", () => {
    const result = applyQueryResultWindow({
      cellMaxChars: 32,
      maxBytes: 12,
      maxRows: 10,
      rows: [["abcdef", "ghijkl", "mnopqr"]],
    });

    expect(result).toEqual({
      rows: [["", "", ""]],
      truncated: true,
    });
    expect(rowsByteLength(result.rows)).toBe(12);
  });

  it("drops a row only when even an all-empty rectangular preview cannot fit", () => {
    const result = applyQueryResultWindow({
      cellMaxChars: 32,
      maxBytes: 14,
      maxRows: 10,
      rows: [["a", "b", "c", "d"]],
    });

    expect(result).toEqual({
      rows: [],
      truncated: true,
    });
  });

  it("accounts for row separators in the total rows payload budget", () => {
    const result = applyQueryResultWindow({
      cellMaxChars: 32,
      maxBytes: 10,
      maxRows: 10,
      rows: [["a"], ["b"]],
    });

    expect(result).toEqual({
      rows: [["a"]],
      truncated: true,
    });
    expect(rowsByteLength(result.rows)).toBeLessThanOrEqual(10);
  });

  it("preserves leftmost cells before compacting later columns", () => {
    const result = applyQueryResultWindow({
      cellMaxChars: 32,
      maxBytes: 10,
      maxRows: 10,
      rows: [["a", "x".repeat(100)]],
    });

    expect(result).toEqual({
      rows: [["a", ""]],
      truncated: true,
    });
  });

  it("uses unicode-safe ellipsis compaction before dropping multibyte cells", () => {
    const result = applyQueryResultWindow({
      cellMaxChars: 32,
      maxBytes: 13,
      maxRows: 10,
      rows: [["😀😀😀😀"]],
    });

    expect(result).toEqual({
      rows: [["😀..."]],
      truncated: true,
    });
    expect(rowsByteLength(result.rows)).toBeLessThanOrEqual(13);
  });
});
