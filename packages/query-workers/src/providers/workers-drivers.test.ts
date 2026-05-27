import type { DatabaseQueryResult } from "@onequery/query/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeBigQueryQuery } from "./bigquery/driver";
import { executeCloudflareD1Query } from "./cloudflare-d1/driver";
import { executeLaminarQuery } from "./laminar/driver";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function expectPreflightFailure(
  invoke: () => Promise<DatabaseQueryResult<unknown>>,
  message: string
) {
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const result = await invoke();
  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.message).toContain(message);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
}

function unwrapQueryResult<T>(result: DatabaseQueryResult<T>): T {
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

describe("Workers query drivers", () => {
  it.each([
    [
      "invalid BigQuery locations",
      () =>
        executeBigQueryQuery(
          {
            accessToken: "bq-access-token",
            authType: "oauth",
            expiresAt: Date.now() + 60_000,
            projectId: "project-123",
            refreshToken: "bq-refresh-token",
            type: "bigquery",
          },
          "SELECT 1",
          {
            location: "us-central1?debug=true",
          }
        ),
      "BigQuery location is invalid",
    ],
    [
      "Laminar base URLs with paths",
      () =>
        executeLaminarQuery(
          {
            apiBaseUrl: "https://api.lmnr.ai/custom-path",
            apiKey: "laminar-api-key",
            type: "laminar",
          },
          "SELECT 1"
        ),
      "Laminar API base URL must not include a path",
    ],
  ])(
    "returns %s failures before attempting execution",
    async (_label, invoke, message) => {
      await expectPreflightFailure(invoke, message);
    }
  );

  it("executes Cloudflare D1 queries through the D1 REST API", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
      json: async () => ({
        errors: [],
        messages: [],
        result: [
          {
            meta: {},
            results: [{ one: 1 }],
            success: true,
          },
        ],
        success: true,
      }),
      ok: true,
      status: 200,
      text: async () => "",
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const rows = unwrapQueryResult(
      await executeCloudflareD1Query(
        {
          accountId: "acct_123",
          apiToken: "cf-token",
          databaseId: "db_123",
          type: "cloudflare_d1",
        },
        "SELECT 1"
      )
    );

    expect(rows).toEqual([{ one: 1 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct_123/d1/database/db_123/query"
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer cf-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init?.body as string)).toEqual({ sql: "SELECT 1" });
  });

  it("sanitizes Cloudflare D1 error text", async () => {
    const fetchSpy = vi.fn(async (_url: string | URL, _init?: RequestInit) => ({
      json: async () => ({}),
      ok: false,
      status: 403,
      text: async () => "Bearer cf-token cannot access cf-token",
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await executeCloudflareD1Query(
      {
        accountId: "acct_123",
        apiToken: "cf-token",
        databaseId: "db_123",
        type: "cloudflare_d1",
      },
      "SELECT 1"
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe(
        "Cloudflare D1 query failed: 403 Bearer [REDACTED] cannot access ***"
      );
    }
  });
});
