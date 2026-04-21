import { describe, expect, it } from "vitest";

import { buildCliQuerySuccessResponse } from "./workflow-result";

const source = {
  credentialsEncrypted: "encrypted",
  credentialsIv: "iv",
  displayName: "Warehouse",
  id: "source-1",
  name: "warehouse",
  organizationId: "org-1",
  provider: "postgres",
  sourceKey: "warehouse",
  status: "active",
} as const;

describe("buildCliQuerySuccessResponse", () => {
  it("normalizes rows and infers logical types for the live query service", () => {
    expect(
      buildCliQuerySuccessResponse({
        elapsedMs: 18.9,
        rows: [
          {
            stringCol: "hello",
            numberCol: 7,
            booleanCol: true,
            bigintCol: 9n,
            datetimeCol: new Date("2026-03-27T11:00:00.000Z"),
            arrayCol: ["a", "b"],
            jsonCol: { nested: 1 },
            nullCol: null,
          },
        ],
        source,
        truncated: true,
      })
    ).toEqual({
      columns: [
        { logicalType: "string", name: "stringCol" },
        { logicalType: "number", name: "numberCol" },
        { logicalType: "boolean", name: "booleanCol" },
        { logicalType: "bigint", name: "bigintCol" },
        { logicalType: "datetime", name: "datetimeCol" },
        { logicalType: "array", name: "arrayCol" },
        { logicalType: "json", name: "jsonCol" },
        { logicalType: null, name: "nullCol" },
      ],
      elapsedMs: 18,
      rowCount: 1,
      rows: [
        [
          "hello",
          "7",
          "true",
          "9",
          "2026-03-27T11:00:00.000Z",
          '["a","b"]',
          '{"nested":1}',
          "null",
        ],
      ],
      source: {
        displayName: "Warehouse",
        id: "source-1",
        provider: "postgres",
        sourceKey: "warehouse",
        status: "active",
      },
      truncated: true,
    });
  });

  it("skips nullish cells when inferring a column type", () => {
    expect(
      buildCliQuerySuccessResponse({
        elapsedMs: -4,
        rows: [{ later: null }, { later: "value" }],
        source,
        truncated: false,
      })
    ).toMatchObject({
      columns: [{ logicalType: "string", name: "later" }],
      elapsedMs: 0,
      rowCount: 2,
      rows: [["null"], ["value"]],
      truncated: false,
    });
  });
});
