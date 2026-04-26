import { describe, expect, it } from "vitest";

import { PROVIDER_TYPES, QUERYABLE_PROVIDER_TYPES } from "./data-sources";

describe("data-sources schema", () => {
  it("matches provider type snapshots", () => {
    expect({
      providers: [...PROVIDER_TYPES],
      queryableProviders: [...QUERYABLE_PROVIDER_TYPES],
    }).toMatchSnapshot();
  });
});
