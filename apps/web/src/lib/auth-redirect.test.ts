import { describe, expect, it } from "vitest";

import { resolveBootstrapCompletionRedirectPath } from "./auth-redirect";

describe("resolveBootstrapCompletionRedirectPath", () => {
  it("resumes device authorization when bootstrap began from the device flow", () => {
    expect(
      resolveBootstrapCompletionRedirectPath({
        organizationId: "org_123",
        redirectPath: "/device?user_code=ab-cd1234",
      })
    ).toBe("/device?user_code=ABCD1234&orgId=org_123");
  });

  it("falls back to onboarding when bootstrap did not begin from the device flow", () => {
    expect(
      resolveBootstrapCompletionRedirectPath({
        organizationId: "org_123",
        redirectPath: "/",
      })
    ).toBe("/onboarding/connect-database?orgId=org_123");
  });

  it("falls back to onboarding when the preserved device code is invalid", () => {
    expect(
      resolveBootstrapCompletionRedirectPath({
        organizationId: "org_123",
        redirectPath: "/device?user_code=bad",
      })
    ).toBe("/onboarding/connect-database?orgId=org_123");
  });
});
