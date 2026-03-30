import { describe, expect, it } from "vitest";

import { sanitizeOnboardingOrganizationId } from "./onboarding-organization-id";

describe("sanitizeOnboardingOrganizationId", () => {
  it("trims valid onboarding organization ids", () => {
    expect(sanitizeOnboardingOrganizationId("  org_123  ")).toBe("org_123");
  });

  it("rejects blank, whitespace-containing, and oversized ids", () => {
    expect(sanitizeOnboardingOrganizationId("   ")).toBeUndefined();
    expect(sanitizeOnboardingOrganizationId("org 123")).toBeUndefined();
    expect(sanitizeOnboardingOrganizationId("o".repeat(129))).toBeUndefined();
  });
});
