import { describe, expect, it } from "vitest";

import { buildDeviceVerificationUrls } from "./cliAuthDeviceAuthorizationStart";

describe("cli auth device authorization start transport", () => {
  it("builds verification URLs from the configured public base URL", () => {
    expect(
      buildDeviceVerificationUrls(
        "https://app.onequery.example/internal",
        "ABCD12"
      )
    ).toEqual({
      verificationCompleteUrl:
        "https://app.onequery.example/device?user_code=ABCD12",
      verificationUrl: "https://app.onequery.example/device",
    });
  });
});
