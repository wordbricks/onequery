import { describe, expect, it } from "vitest";

import { sanitizeOnboardingOrganizationId } from "./onboarding-organization-id";

describe("sanitizeOnboardingOrganizationId", () => {
  it("trims valid onboarding organization ids", () => {
    expect(sanitizeOnboardingOrganizationId("  org_123  ")).toBe("org_123");
  });

  it.each(["   ", "org 123", "o".repeat(129)])(
    "rejects invalid onboarding organization id %s",
    (value) => {
      expect(sanitizeOnboardingOrganizationId(value)).toBeUndefined();
    }
  );
});
