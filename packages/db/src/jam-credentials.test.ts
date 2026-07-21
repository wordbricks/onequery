import { describe, expect, it } from "vitest";

import { JamCredentialsSchema } from "./credentials";
import { safeParseSourceProviderCredentials } from "./source-providers";

describe("Jam credentials", () => {
  it("accepts a non-empty personal access token", () => {
    expect(
      JamCredentialsSchema.safeParse({
        accessToken: "jam_pat_secret",
        type: "jam",
      }).success
    ).toBe(true);
  });

  it("rejects an empty personal access token", () => {
    expect(
      JamCredentialsSchema.safeParse({ accessToken: "   ", type: "jam" })
        .success
    ).toBe(false);
  });

  it("injects the Jam credential discriminator from the provider", () => {
    const result = safeParseSourceProviderCredentials({
      credentials: { accessToken: "jam_pat_secret" },
      provider: "jam",
    });

    expect(result).toMatchObject({
      data: {
        credentials: { accessToken: "jam_pat_secret", type: "jam" },
        provider: "jam",
      },
      success: true,
    });
  });
});
