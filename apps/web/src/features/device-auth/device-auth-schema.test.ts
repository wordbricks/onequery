import { describe, expect, it } from "vitest";

import { normalizeDeviceUserCode } from "./device-auth-schema";

describe("normalizeDeviceUserCode", () => {
  it("normalizes valid device codes into the canonical uppercase format", () => {
    expect(normalizeDeviceUserCode(" abcd-1234 ")).toBe("ABCD1234");
  });

  it("rejects codes that do not match the expected bounded format", () => {
    expect(normalizeDeviceUserCode("abc")).toBeUndefined();
    expect(normalizeDeviceUserCode("abcd_1234")).toBeUndefined();
    expect(normalizeDeviceUserCode("abcd12345")).toBeUndefined();
  });
});
