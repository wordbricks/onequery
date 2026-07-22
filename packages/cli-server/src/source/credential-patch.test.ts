import { describe, expect, it } from "vitest";

import { mergeSourceCredentialPatch } from "./credential-patch";

describe("mergeSourceCredentialPatch", () => {
  it("retains omitted secrets while replacing requested credential fields", () => {
    expect(
      mergeSourceCredentialPatch(
        {
          authToken: "secret-token",
          organizationSlug: "getgpt",
          type: "sentry",
        },
        { organizationSlug: "wordbricks" }
      )
    ).toEqual({
      ok: true,
      value: {
        authToken: "secret-token",
        organizationSlug: "wordbricks",
        type: "sentry",
      },
    });
  });

  it.each([null, [], {}, "credentials", 42])(
    "rejects a non-object or empty credential patch: %j",
    (patch) => {
      expect(
        mergeSourceCredentialPatch(
          { authToken: "secret-token", type: "sentry" },
          patch
        )
      ).toEqual({
        detail: "credentials must be a non-empty JSON object",
        ok: false,
      });
    }
  );

  it("rejects credential type changes", () => {
    expect(
      mergeSourceCredentialPatch(
        { authToken: "secret-token", type: "sentry" },
        { type: "github" }
      )
    ).toEqual({
      detail: 'credentials.type must remain "sentry"',
      ok: false,
    });
  });
});
