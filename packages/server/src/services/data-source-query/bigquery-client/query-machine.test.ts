import { afterEach, describe, expect, it, vi } from "vitest";

import { runBigQueryQuery } from "./query-machine";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("BigQuery query runner", () => {
  it("does not send or enforce maxResults while loading query pages", async () => {
    const requests: { body: unknown; url: URL }[] = [];
    const responses = [
      {
        jobComplete: true,
        jobReference: {
          jobId: "job-1",
          location: "US",
        },
        pageToken: "page-2",
        rows: [{ f: [{ v: "1" }] }],
        schema: {
          fields: [{ name: "id", type: "STRING" }],
        },
      },
      {
        jobComplete: true,
        jobReference: {
          jobId: "job-1",
          location: "US",
        },
        rows: [{ f: [{ v: "2" }] }],
      },
    ];

    const fetchSpy = vi.fn(async (url: string | URL, init?: RequestInit) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        url: new URL(String(url)),
      });

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(responses.shift()),
      } as Response;
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await runBigQueryQuery({
      accessTokenPromise: Promise.resolve("bq-access-token"),
      projectId: "project-123",
      query: "SELECT id FROM users",
      timeoutMs: 1000,
    });

    expect(result.rows).toEqual([{ id: "1" }, { id: "2" }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(requests[0]?.body)).not.toContain("maxResults");
    expect(requests[0]?.url.searchParams.has("maxResults")).toBe(false);
    expect(requests[1]?.url.searchParams.get("pageToken")).toBe("page-2");
    expect(requests[1]?.url.searchParams.has("maxResults")).toBe(false);
  });
});
