import { describe, expect, it } from "vitest";

import { projectCliSourceSummary } from "./source-response";

const source = {
  displayName: "Warehouse",
  name: "warehouse",
  provider: "postgres" as const,
  queryable: true,
  status: "active" as const,
};

describe("cli source transport projection", () => {
  it("projects list-scoped source fields", () => {
    expect(
      projectCliSourceSummary(
        source,
        new Set(["sources.name", "sources.status"]),
        "sources"
      )
    ).toEqual({
      name: "warehouse",
      status: "active",
    });
  });

  it("projects source show fields without a transport prefix", () => {
    expect(
      projectCliSourceSummary(source, new Set(["name", "displayName"]))
    ).toEqual({
      displayName: "Warehouse",
      name: "warehouse",
    });
  });

  it("returns the full source when the root field is selected", () => {
    expect(projectCliSourceSummary(source, new Set(["source"]), "source")).toBe(
      source
    );
  });
});
