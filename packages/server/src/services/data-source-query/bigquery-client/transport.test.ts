import { afterEach, describe, expect, it, vi } from "vitest";

import { requestBigQueryJson } from "./transport";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("bigquery transport", () => {
  it.each([
    [
      "invalid API paths",
      {
        path: "/jobs/../secrets",
      },
      "BigQuery API path is invalid.",
    ],
    [
      "control characters in query parameters",
      {
        path: "/datasets",
        query: {
          pageToken: "abc\r\nx-injected: bad",
        },
      },
      'BigQuery query parameter "pageToken" is invalid.',
    ],
  ])("rejects %s before calling fetch", async (_label, overrides, message) => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      requestBigQueryJson({
        accessTokenPromise: Promise.resolve("bq-access-token"),
        ...overrides,
        projectId: "project-123",
      })
    ).rejects.toThrow(message);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
