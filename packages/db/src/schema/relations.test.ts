import { describe, expect, it } from "vitest";

import {
  bigqueryQueryCostsRelations,
  connectorJobsRelations,
  connectorsRelations,
  dataSourceQueryCostsRelations,
  dataSourceTableUsageRelations,
  dataSourcesRelations,
  organizationProfilesRelations,
  userProfilesRelations,
} from "./relations";

describe("relations", () => {
  it("exports the OSS-safe relation definitions", () => {
    const relationExports = {
      bigqueryQueryCostsRelations,
      connectorJobsRelations,
      connectorsRelations,
      dataSourceQueryCostsRelations,
      dataSourceTableUsageRelations,
      dataSourcesRelations,
      organizationProfilesRelations,
      userProfilesRelations,
    };

    expect(Object.keys(relationExports)).toHaveLength(8);

    for (const relation of Object.values(relationExports)) {
      expect(relation).toBeTruthy();
    }
  });
});
