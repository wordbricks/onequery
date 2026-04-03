import { describe, expect, it } from "vitest";

import { normalizeDeviceUserCode } from "./device-auth-schema";

describe("normalizeDeviceUserCode", () => {
  it("normalizes valid device codes into the canonical uppercase format", () => {
    expect(normalizeDeviceUserCode(" abcd-1234 ")).toBe("ABCD1234");
  });

  it.each(["abc", "abcd_1234", "abcd12345"])(
    "rejects code %s when it does not match the expected bounded format",
    (code) => {
      expect(normalizeDeviceUserCode(code)).toBeUndefined();
    }
  );
});
