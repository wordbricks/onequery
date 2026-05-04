import { describe, expect, it } from "vitest";

import { createServerApiApp } from "./app";
import { createTestRuntimeConfig } from "./routes/test-env";

describe("createServerApiApp", () => {
  it("assigns a request id to API responses", async () => {
    const runtime = createTestRuntimeConfig();
    expect(runtime.isOk()).toBe(true);
    if (runtime.isErr()) {
      return;
    }

    const app = createServerApiApp({ runtime: runtime.value });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toEqual(expect.any(String));
  });
});
