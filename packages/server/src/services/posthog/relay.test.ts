import { describe, expect, it } from "vitest";

import { runPostHogQuery } from "./relay";

const credentials = {
  hostUrl: "https://us.posthog.com",
  personalApiKey: "posthog-api-key",
  projectId: "12345",
  type: "posthog" as const,
};

describe("posthog relay", () => {
  it("rejects host URLs with embedded credentials", async () => {
    await expect(
      runPostHogQuery({
        credentials: {
          ...credentials,
          hostUrl: "https://user:pass@us.posthog.com",
        },
        query: { kind: "HogQLQuery", query: "SELECT 1" },
      })
    ).rejects.toThrow("PostHog host URL must not include URL credentials");
  });

  it("rejects host URLs with path components", async () => {
    await expect(
      runPostHogQuery({
        credentials: {
          ...credentials,
          hostUrl: "https://us.posthog.com/custom-path",
        },
        query: { kind: "HogQLQuery", query: "SELECT 1" },
      })
    ).rejects.toThrow("PostHog host URL must not include a path");
  });

  it("rejects refresh values with control characters", async () => {
    await expect(
      runPostHogQuery({
        credentials,
        query: { kind: "HogQLQuery", query: "SELECT 1" },
        refresh: "blocking\r\nx-injected: bad",
      })
    ).rejects.toThrow("PostHog refresh must not contain control characters");
  });
});
