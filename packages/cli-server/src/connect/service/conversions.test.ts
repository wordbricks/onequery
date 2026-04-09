import { describe, expect, it } from "vitest";

import { CliOrgCapability } from "../gen/onequery/cli/v1/org_pb";
import { toCliOrgCapability } from "./conversions";

describe("toCliOrgCapability", () => {
  it("maps source API actions to first-class org capabilities", () => {
    expect(toCliOrgCapability("source_api.describe")).toBe(
      CliOrgCapability.SOURCE_API_DESCRIBE
    );
    expect(toCliOrgCapability("source_api.execute")).toBe(
      CliOrgCapability.SOURCE_API_EXECUTE
    );
  });
});
