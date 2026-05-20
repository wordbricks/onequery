import { describe, expect, it } from "vitest";

import {
  createCliSourceKey,
  getCliSourceInterfaceTypes,
  sortCliSourceRecords,
} from "./model";

describe("source model", () => {
  it("sorts loaded source records by source key and provider", () => {
    const sources: Parameters<typeof sortCliSourceRecords>[0] = [
      {
        displayName: null,
        id: "source-1",
        provider: "postgres",
        sourceKey: "warehouse",
        status: "active",
      },
      {
        displayName: null,
        id: "source-2",
        provider: "linear",
        sourceKey: "team_linear",
        status: "active",
      },
      {
        displayName: null,
        id: "source-3",
        provider: "postgres",
        sourceKey: "broken_warehouse",
        status: "error",
      },
    ];

    expect(sortCliSourceRecords(sources)).toMatchSnapshot();
  });

  it("rejects traversal-style source keys when normalizing db rows", () => {
    expect(createCliSourceKey(" .. ")).toBeNull();
  });

  it("exposes BigQuery as both query and API capable", () => {
    expect(getCliSourceInterfaceTypes("bigquery", "active")).toEqual([
      "query",
      "api",
    ]);
  });

  it("exposes Cloudflare D1 as query capable", () => {
    expect(getCliSourceInterfaceTypes("cloudflare_d1", "active")).toEqual([
      "query",
    ]);
  });
});
