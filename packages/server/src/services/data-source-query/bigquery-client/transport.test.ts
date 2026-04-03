import { afterEach, describe, expect, it, vi } from "vitest";

import { requestBigQueryJson } from "./transport";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("bigquery transport", () => {
  it("rejects invalid API paths before calling fetch", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      requestBigQueryJson({
        accessTokenPromise: Promise.resolve("bq-access-token"),
        path: "/jobs/../secrets",
        projectId: "project-123",
      })
    ).rejects.toThrow("BigQuery API path is invalid.");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects control characters in query parameters", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      requestBigQueryJson({
        accessTokenPromise: Promise.resolve("bq-access-token"),
        path: "/datasets",
        projectId: "project-123",
        query: {
          pageToken: "abc\r\nx-injected: bad",
        },
      })
    ).rejects.toThrow('BigQuery query parameter "pageToken" is invalid.');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
