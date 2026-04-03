import { describe, expect, it } from "vitest";

import { runPostHogQuery } from "./relay";

const credentials = {
  hostUrl: "https://us.posthog.com",
  personalApiKey: "posthog-api-key",
  projectId: "12345",
  type: "posthog" as const,
};

describe("posthog relay", () => {
  it.each([
    [
      "host URLs with embedded credentials",
      () =>
        runPostHogQuery({
          credentials: {
            ...credentials,
            hostUrl: "https://user:pass@us.posthog.com",
          },
          query: { kind: "HogQLQuery", query: "SELECT 1" },
        }),
      "PostHog host URL must not include URL credentials",
    ],
    [
      "host URLs with path components",
      () =>
        runPostHogQuery({
          credentials: {
            ...credentials,
            hostUrl: "https://us.posthog.com/custom-path",
          },
          query: { kind: "HogQLQuery", query: "SELECT 1" },
        }),
      "PostHog host URL must not include a path",
    ],
    [
      "refresh values with control characters",
      () =>
        runPostHogQuery({
          credentials,
          query: { kind: "HogQLQuery", query: "SELECT 1" },
          refresh: "blocking\r\nx-injected: bad",
        }),
      "PostHog refresh must not contain control characters",
    ],
  ])("rejects %s", async (_label, invoke, message) => {
    await expect(invoke()).rejects.toThrow(message);
  });
});
