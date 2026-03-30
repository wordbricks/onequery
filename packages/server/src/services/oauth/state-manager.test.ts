import { describe, expect, it } from "vitest";

import {
  createOAuthState,
  parseOAuthState,
  validateOAuthState,
} from "./state-manager";

describe("oauth state manager", () => {
  it("rejects empty signing secrets", async () => {
    await expect(
      createOAuthState("   ", {
        organizationId: "org_123",
        provider: "github",
        redirectTo: "/settings",
      })
    ).rejects.toThrowError("OAuth state secret must be configured");

    await expect(validateOAuthState("   ", "state")).rejects.toThrowError(
      "OAuth state secret must be configured"
    );
  });

  it("rejects state tokens with extra separators", async () => {
    const state = await createOAuthState("test-secret", {
      organizationId: "org_123",
      provider: "github",
      redirectTo: "/settings",
    });

    await expect(
      parseOAuthState("test-secret", `${state}.extra`)
    ).resolves.toBe(null);
  });
});
