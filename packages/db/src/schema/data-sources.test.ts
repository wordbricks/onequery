import { describe, expect, it } from "vitest";

import { ANALYSIS_SOURCE_PROVIDER_TYPES, PROVIDER_TYPES } from "./data-sources";

describe("data-sources schema", () => {
  it("matches provider type snapshots", () => {
    expect({
      analysisSourceProviders: [...ANALYSIS_SOURCE_PROVIDER_TYPES],
      providers: [...PROVIDER_TYPES],
    }).toMatchSnapshot();
  });
});
