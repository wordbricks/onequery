import { describe, expect, it } from "vitest";

import { buildDeviceAuthPath, DEVICE_ROUTE } from "@/lib/app-routes";

describe("buildDeviceAuthPath", () => {
  it("returns the base device route when no valid code is provided", () => {
    expect(buildDeviceAuthPath()).toBe(DEVICE_ROUTE);
    expect(buildDeviceAuthPath("bad-code", "org_123")).toBe(DEVICE_ROUTE);
  });

  it("canonicalizes the device code and preserves the onboarding org id", () => {
    expect(buildDeviceAuthPath(" abcd-1234 ", "org_123")).toBe(
      "/device?user_code=ABCD1234&orgId=org_123"
    );
  });
});
