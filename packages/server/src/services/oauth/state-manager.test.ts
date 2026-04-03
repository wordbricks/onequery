import { describe, expect, it } from "vitest";

import {
  createOAuthState,
  parseOAuthState,
  validateOAuthState,
} from "./state-manager";

describe("oauth state manager", () => {
  it.each([
    [
      "createOAuthState",
      () =>
        createOAuthState("   ", {
          organizationId: "org_123",
          provider: "github",
          redirectTo: "/settings",
        }),
    ],
    ["validateOAuthState", () => validateOAuthState("   ", "state")],
  ])("rejects empty signing secrets in %s", async (_name, invoke) => {
    await expect(invoke()).rejects.toThrow(
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
