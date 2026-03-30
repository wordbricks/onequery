import { describe, expect, it } from "vitest";

import { normalizeDataSourceErrorDescription } from "./data-source-error-toast";

describe("normalizeDataSourceErrorDescription", () => {
  it("collapses whitespace for short user-safe descriptions", () => {
    expect(
      normalizeDataSourceErrorDescription(
        "Failed to test data source",
        "  Connection failed \n because the host is unreachable.  "
      )
    ).toBe("Connection failed because the host is unreachable.");
  });

  it("redacts suspicious data source error details", () => {
    expect(
      normalizeDataSourceErrorDescription(
        "Failed to update GitHub repositories",
        "Bearer token expired for organization oauth session"
      )
    ).toBe("Review the data source settings and try again.");
  });
});
