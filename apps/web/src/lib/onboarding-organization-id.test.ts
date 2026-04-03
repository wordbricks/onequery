import { describe, expect, it } from "vitest";

import { sanitizeOnboardingOrganizationId } from "./onboarding-organization-id";

describe("sanitizeOnboardingOrganizationId", () => {
  it("trims valid onboarding organization ids", () => {
    expect(sanitizeOnboardingOrganizationId("  org_123  ")).toBe("org_123");
  });

  it("rejects invalid onboarding organization ids", () => {
    expect(sanitizeOnboardingOrganizationId("org 123")).toBeUndefined();
  });
});
