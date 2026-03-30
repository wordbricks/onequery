import { describe, expect, it } from "vitest";

import { fetchSentryApi } from "./relay";

const credentials = {
  authToken: "sentry-auth-token",
  organizationSlug: "acme",
  projectSlug: "frontend",
  type: "sentry" as const,
};

describe("sentry relay", () => {
  it("rejects API base URLs with embedded credentials", async () => {
    await expect(
      fetchSentryApi({
        credentials: {
          ...credentials,
          apiBaseUrl: "https://user:pass@sentry.example.com/api/0",
        },
        endpoint: "/organizations/{organizationSlug}/projects/",
      })
    ).rejects.toThrowError(
      "Sentry API base URL must not include URL credentials"
    );
  });

  it("rejects absolute endpoint URLs", async () => {
    await expect(
      fetchSentryApi({
        credentials,
        endpoint: "https://sentry.io/api/0/projects/",
      })
    ).rejects.toThrowError(
      "Sentry endpoint must be a relative path without control characters, query params, or fragments"
    );
  });

  it("rejects reserved auth query params", async () => {
    await expect(
      fetchSentryApi({
        credentials,
        endpoint: "/organizations/{organizationSlug}/projects/",
        options: {
          params: {
            auth_token: "override",
          },
        },
      })
    ).rejects.toThrowError('Sentry query param "auth_token" is not allowed');
  });
});
