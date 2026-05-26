import { describe, expect, it } from "vitest";

import {
  formatCliSourceReference,
  parseCliSourceReference,
  parseCliSourceSelector,
} from "./reference";

describe("source references", () => {
  it("formats provider-prefixed source references", () => {
    expect(formatCliSourceReference("postgres", "gg-prod")).toBe(
      "postgres://gg-prod"
    );
  });

  it("parses provider-prefixed source references", () => {
    expect(parseCliSourceReference(" bigquery://bq-hello ")).toEqual({
      provider: "bigquery",
      sourceKey: "bq-hello",
    });
  });

  it("treats bare keys as legacy selectors", () => {
    expect(parseCliSourceSelector("github-prod")).toEqual({
      sourceKey: "github-prod",
    });
  });

  it("rejects unknown providers and unsafe keys", () => {
    expect([
      parseCliSourceReference("unknown://source"),
      parseCliSourceReference("github://repo/main"),
      parseCliSourceReference("github"),
    ]).toEqual([null, null, null]);
  });
});
