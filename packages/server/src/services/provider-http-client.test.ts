import { describe, expect, it, vi } from "vitest";

import { ProviderHttpClient } from "./provider-http-client";

describe("ProviderHttpClient", () => {
  it("calls the default fetch with the global receiver", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async function defaultFetchMock(this: unknown) {
      expect(this).toBe(globalThis);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const client = new ProviderHttpClient({
        auth: { token: "token", type: "bearer" },
        baseUrl: "https://api.example.com",
        providerName: "Example",
      });

      await client.get("/events");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sanitizes provider error responses", async () => {
    const client = new ProviderHttpClient({
      auth: { token: "secret-token", type: "bearer" },
      baseUrl: "https://api.example.com",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          new Response("secret-token exploded", { status: 401 })
        ) as unknown as typeof fetch,
      providerName: "Example",
      sanitize: (text) => text.replaceAll("secret-token", "***"),
    });

    await expect(client.get("/events")).rejects.toThrow(
      "Example API error (401): *** exploded"
    );
  });

  it.each([
    [
      "endpoint query string",
      (client: ProviderHttpClient) => client.get("/events?authorization=bad"),
    ],
    [
      "params input",
      (client: ProviderHttpClient) =>
        client.get("/events", { authorization: "bad" }),
    ],
  ])("rejects blocked query params from %s", async (_source, invoke) => {
    const client = new ProviderHttpClient({
      auth: { token: "token", type: "bearer" },
      baseUrl: "https://api.example.com",
      blockedParams: new Set(["authorization"]),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      providerName: "Example",
    });

    await expect(invoke(client)).rejects.toThrow(
      'Provider request param "authorization" is not allowed'
    );
  });

  it("preserves caller header casing in fetch init", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );
    const client = new ProviderHttpClient({
      auth: { token: "token", type: "bearer" },
      baseUrl: "https://api.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      providerName: "Example",
    });

    await client.send({
      endpoint: "/events",
      headers: {
        Accept: "application/json",
        "User-Agent": "onequery-test",
      },
      method: "GET",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer token",
          "User-Agent": "onequery-test",
        }),
      })
    );
  });
});
