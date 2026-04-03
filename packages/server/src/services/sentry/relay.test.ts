import { describe, expect, it } from "vitest";

import { fetchSentryApi } from "./relay";

const credentials = {
  authToken: "sentry-auth-token",
  organizationSlug: "acme",
  projectSlug: "frontend",
  type: "sentry" as const,
};

describe("sentry relay", () => {
  it.each([
    [
      "API base URLs with embedded credentials",
      () =>
        fetchSentryApi({
          credentials: {
            ...credentials,
            apiBaseUrl: "https://user:pass@sentry.example.com/api/0",
          },
          endpoint: "/organizations/{organizationSlug}/projects/",
        }),
      "Sentry API base URL must not include URL credentials",
    ],
    [
      "absolute endpoint URLs",
      () =>
        fetchSentryApi({
          credentials,
          endpoint: "https://sentry.io/api/0/projects/",
        }),
      "Sentry endpoint must be a relative path without control characters, query params, or fragments",
    ],
    [
      "reserved auth query params",
      () =>
        fetchSentryApi({
          credentials,
          endpoint: "/organizations/{organizationSlug}/projects/",
          options: {
            params: {
              auth_token: "override",
            },
          },
        }),
      'Sentry query param "auth_token" is not allowed',
    ],
  ])("rejects %s", async (_label, invoke, message) => {
    await expect(invoke()).rejects.toThrow(message);
  });
});
