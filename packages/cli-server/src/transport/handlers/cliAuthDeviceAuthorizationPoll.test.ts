import { describe, expect, it } from "vitest";

import { buildAuthorizedDeviceAuthorizationResponse } from "./cliAuthDeviceAuthorizationPoll";

describe("cli auth device authorization poll transport", () => {
  it("projects the resolved session into the authorized poll response", () => {
    expect(
      buildAuthorizedDeviceAuthorizationResponse({
        accessToken: "pat_cli_123",
        session: {
          accessToken: "pat_cli_123",
          activeOrg: "acme",
          authMode: "bearer_token",
          expiresAt: "2026-03-27T00:05:00.000Z",
          issuedAt: "2026-03-27T00:00:00.000Z",
          user: {
            displayName: "Ada Lovelace",
            email: "ada@example.com",
            id: "user_123",
          },
        },
      })
    ).toEqual({
      state: "authorized",
      accessToken: "pat_cli_123",
      activeOrgSlug: "acme",
      authMode: "bearer_token",
      expiresAt: "2026-03-27T00:05:00.000Z",
      issuedAt: "2026-03-27T00:00:00.000Z",
      user: {
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        id: "user_123",
      },
    });
  });

  it("surfaces a structured cli auth problem when the session lookup is missing", () => {
    let thrown: unknown;

    try {
      buildAuthorizedDeviceAuthorizationResponse({
        accessToken: "pat_cli_123",
        session: null,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      problemDetails: {
        detail:
          "device authorization completed, but no authenticated session could be resolved",
        status: 401,
        title: "Not Logged In",
        type: "https://onequery.invalid/problems/cli/not-logged-in",
        extensions: {
          code: "not_logged_in",
          hint: "run `onequery auth login` again",
          retryable: false,
          stage: "auth",
        },
      },
    });
  });
});
