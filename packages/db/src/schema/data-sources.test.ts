import { describe, expect, it } from "vitest";

import { PROVIDER_TYPES, QUERYABLE_PROVIDER_TYPES } from "./data-sources";

describe("data-sources schema", () => {
  it("matches provider type snapshots", () => {
    expect({
      providers: [...PROVIDER_TYPES],
      queryableProviders: [...QUERYABLE_PROVIDER_TYPES],
    }).toMatchSnapshot();
  });

  describe("QUERYABLE_PROVIDER_TYPES", () => {
    it("should be a subset of PROVIDER_TYPES", () => {
      for (const provider of QUERYABLE_PROVIDER_TYPES) {
        expect(PROVIDER_TYPES).toContain(provider);
      }
    });
  });
});
