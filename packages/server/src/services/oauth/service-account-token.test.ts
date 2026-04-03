import { afterEach, describe, expect, it, vi } from "vitest";

import { getServiceAccountAccessToken } from "./service-account-token";

const originalFetch = globalThis.fetch;

async function createPrivateKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const base64 = Buffer.from(pkcs8).toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("service account token", () => {
  it("rejects empty required fields before making a request", async () => {
    await expect(
      getServiceAccountAccessToken({
        clientEmail: "   ",
        privateKey: await createPrivateKeyPem(),
        scope: "scope",
      })
    ).rejects.toThrow("clientEmail is required");
  });

  it("surfaces sanitized provider error details", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid service account credentials",
          }),
          {
            headers: { "content-type": "application/json" },
            status: 400,
          }
        )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      getServiceAccountAccessToken({
        clientEmail: "service-account@example.com",
        privateKey: await createPrivateKeyPem(),
        scope: "https://www.googleapis.com/auth/analytics.readonly",
      })
    ).rejects.toThrow(
      "Failed to exchange service account token: 400 Invalid service account credentials"
    );
  });
});
