import { describe, expect, it } from "vitest";

import { readNavigationErrorMessage } from "./device-auth-machine";

describe("readNavigationErrorMessage", () => {
  it("keeps browser-visible navigation failures generic", () => {
    expect(
      readNavigationErrorMessage(new Error("secret redirect failure"))
    ).toBe("Couldn't update the device URL. Try the same action again.");
  });
});
