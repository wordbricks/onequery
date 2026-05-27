import { afterEach, describe, expect, it, vi } from "vitest";

import { runBigQueryDryRun } from "./dry-run";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("BigQuery dry run", () => {
  it("does not send maxResults", async () => {
    let requestBody: unknown;
    const fetchSpy = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            statistics: {
              query: {
                totalBytesProcessed: "123",
              },
            },
          }),
      } as Response;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      runBigQueryDryRun({
        accessTokenPromise: Promise.resolve("bq-access-token"),
        projectId: "project-123",
        query: "SELECT id FROM users",
        timeoutMs: 1000,
      })
    ).resolves.toBe("123");

    expect(JSON.stringify(requestBody)).not.toContain("maxResults");
  });
});
