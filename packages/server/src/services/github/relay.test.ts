import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchGitHubApi, listGitHubRepositories } from "./relay";

const credentials = {
  accessToken: "ghp_test-token",
  repositories: ["openai/example"],
  type: "github" as const,
};
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("github relay", () => {
  it("rejects credential-like query parameters", async () => {
    await expect(
      fetchGitHubApi({
        credentials,
        endpoint: "/repos/openai/example/issues",
        options: {
          params: {
            access_token: "should-not-be-forwarded",
          },
        },
      })
    ).rejects.toThrow('GitHub request param "access_token" is not allowed');
  });

  it("rejects full URLs with embedded credentials", async () => {
    await expect(
      fetchGitHubApi({
        credentials,
        endpoint:
          "https://user:pass@api.github.com/repos/openai/example/issues",
      })
    ).rejects.toThrow("GitHub endpoint must not include URL credentials");
  });

  it("rejects headers containing control characters", async () => {
    await expect(
      fetchGitHubApi({
        credentials,
        endpoint: "/repos/openai/example/issues",
        options: {
          headers: {
            "x-test": "value\r\nx-injected: bad",
          },
        },
      })
    ).rejects.toThrow("Invalid GitHub header: x-test");
  });

  it("uses the shared repositories listing request defaults", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ full_name: "openai/example" }]), {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await listGitHubRepositories({ credentials });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchSpy.mock.calls[0] ?? [];
    expect(String(requestUrl)).toContain("/user/repos?");
    expect(String(requestUrl)).toContain("per_page=100");
    expect(String(requestUrl)).toContain("sort=updated");
    expect(String(requestUrl)).toContain("direction=desc");
    expect(String(requestUrl)).toContain(
      "affiliation=owner%2Ccollaborator%2Corganization_member"
    );
    expect(requestInit).toMatchObject({
      headers: expect.objectContaining({
        Accept: "application/vnd.github+json",
        Authorization: "Bearer ghp_test-token",
        "User-Agent": "onequery-app",
        "X-GitHub-Api-Version": "2022-11-28",
      }),
      method: "GET",
    });
  });
});
