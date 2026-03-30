import { describe, expect, it } from "vitest";

import {
  resolveGoogleAnalyticsAccessToken,
  resolveGoogleAnalyticsPropertyPath,
  runGoogleAnalyticsDataRequest,
} from "./relay";

describe("google analytics relay", () => {
  it("rejects malformed property paths", () => {
    expect(
      resolveGoogleAnalyticsPropertyPath({
        credentials: {
          accessToken: "ga-access-token",
          expiresAt: Date.now() + 60_000,
          propertyId: "properties/12345",
          refreshToken: "ga-refresh-token",
          type: "ga",
        },
        request: {
          property: "properties/12345/reports",
        },
      })
    ).toBeNull();
  });

  it("rejects empty oauth access tokens", async () => {
    await expect(
      resolveGoogleAnalyticsAccessToken({
        credentials: {
          accessToken: "   ",
          expiresAt: Date.now() + 60_000,
          propertyId: "properties/12345",
          refreshToken: "ga-refresh-token",
          type: "ga",
        },
      })
    ).rejects.toThrowError("Google Analytics access token is required");
  });

  it("rejects invalid property paths before issuing a request", async () => {
    await expect(
      runGoogleAnalyticsDataRequest({
        accessToken: "ga-access-token",
        method: "run_report",
        propertyPath: "properties/12345/reports",
        requestBody: {},
      })
    ).rejects.toThrowError(
      "Google Analytics property must be a property ID or properties/<id>"
    );
  });
});
