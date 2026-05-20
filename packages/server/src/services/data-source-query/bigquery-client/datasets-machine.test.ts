import { afterEach, describe, expect, it, vi } from "vitest";

import { listProjectDatasets } from "./datasets-machine";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("BigQuery dataset listing", () => {
  it("does not force a maxResults query parameter", async () => {
    let requestUrl: URL | undefined;
    const fetchSpy = vi.fn(async (url: string | URL) => {
      requestUrl = new URL(String(url));

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ datasets: [] }),
      } as Response;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      listProjectDatasets({
        accessTokenPromise: Promise.resolve("bq-access-token"),
        projectId: "project-123",
      })
    ).resolves.toEqual([]);

    expect(requestUrl?.searchParams.get("all")).toBe("true");
    expect(requestUrl?.searchParams.has("maxResults")).toBe(false);
  });
});
