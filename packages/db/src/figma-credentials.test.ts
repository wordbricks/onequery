import { describe, expect, it } from "vitest";

import { FigmaCredentialsSchema } from "./credentials";
import { safeParseSourceProviderCredentials } from "./source-providers";

describe("Figma credentials", () => {
  it("accepts a personal access token", () => {
    expect(
      FigmaCredentialsSchema.safeParse({
        personalAccessToken: "figd_test_token",
        type: "figma",
      }).success
    ).toBe(true);
  });

  it("rejects blank personal access tokens", () => {
    expect(
      FigmaCredentialsSchema.safeParse({
        personalAccessToken: "   ",
        type: "figma",
      }).success
    ).toBe(false);
  });

  it("injects the credential discriminator from the provider", () => {
    const parsed = safeParseSourceProviderCredentials({
      credentials: { personalAccessToken: "figd_test_token" },
      provider: "figma",
    });

    expect(parsed).toMatchObject({
      data: {
        credentials: {
          personalAccessToken: "figd_test_token",
          type: "figma",
        },
        provider: "figma",
      },
      success: true,
    });
  });
});
