import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeBigQueryQuery,
  executeDatabaseQuery,
  executeLaminarQuery,
} from "./execute-query";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("data source query execution", () => {
  it("rejects non-read-only SQL before attempting execution", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      executeDatabaseQuery({
        credentials: {
          database: "app",
          host: "localhost",
          password: "secret",
          port: 5432,
          sslMode: "prefer",
          type: "postgres",
          username: "app",
        },
        sql: "DELETE FROM users",
      })
    ).rejects.toThrowError("Only SELECT queries are allowed.");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid BigQuery locations before making a request", async () => {
    await expect(
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
      )
    ).rejects.toThrowError("BigQuery location is invalid");
  });

  it("rejects Laminar base URLs with paths before making a request", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      executeLaminarQuery(
        {
          apiBaseUrl: "https://api.lmnr.ai/custom-path",
          apiKey: "laminar-api-key",
          type: "laminar",
        },
        "SELECT 1"
      )
    ).rejects.toThrowError("Laminar API base URL must not include a path");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
