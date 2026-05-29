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

  it("requires selectors to include provider schemes", () => {
    expect(parseCliSourceSelector({ sourceKey: "github-prod" })).toBeNull();
    expect(
      parseCliSourceSelector({
        provider: "github",
        sourceKey: "github-prod",
      })
    ).toEqual({
      sourceKey: "github-prod",
      sourceProvider: "github",
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
