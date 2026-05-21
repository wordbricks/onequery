import { afterEach, describe, expect, it, vi } from "vitest";

import { testGitHubConnection } from "./github-tester";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("testGitHubConnection", () => {
  it("validates the token and selected repositories", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ login: "alice" })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ full_name: "siisee11/cvs" }))
      ) as unknown as typeof fetch;

    const result = await testGitHubConnection({
      accessToken: "github-token",
      repositories: ["siisee11/cvs"],
      type: "github",
    });

    expect(result.isOk()).toBe(true);
    const calls = (
      globalThis.fetch as unknown as {
        mock: { calls: [URL | string, RequestInit | undefined][] };
      }
    ).mock.calls;
    expect(String(calls[0]?.[0])).toBe("https://api.github.com/user");
    expect(calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github-token",
        }),
      })
    );
    expect(String(calls[1]?.[0])).toBe(
      "https://api.github.com/repos/siisee11/cvs"
    );
  });

  it("fails invalid repository selections before storing a source", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ login: "alice" }))
      ) as unknown as typeof fetch;

    const result = await testGitHubConnection({
      accessToken: "github-token",
      repositories: ["siisee11/cvs/extra"],
      type: "github",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.detail).toContain("owner/repo format");
    }
  });
});
