import { describe, expect, it } from "vitest";

import {
  buildDeviceAuthPath,
  buildInvitePath,
  DEVICE_ROUTE,
} from "@/lib/app-routes";

describe("buildDeviceAuthPath", () => {
  it("returns the base device route when no code is provided", () => {
    expect(buildDeviceAuthPath()).toBe(DEVICE_ROUTE);
    expect(buildDeviceAuthPath("")).toBe(DEVICE_ROUTE);
  });

  it("encodes the device code in the redirect path", () => {
    expect(buildDeviceAuthPath("ABCD 1234")).toBe(
      "/device?user_code=ABCD+1234"
    );
  });
});

describe("buildInvitePath", () => {
  it("builds the public invite route for an invitation id", () => {
    expect(buildInvitePath("invite_123")).toBe("/invite/invite_123");
  });
});
