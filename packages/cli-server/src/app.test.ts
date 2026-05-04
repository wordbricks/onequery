import { createTestRuntimeConfig } from "@onequery/server/routes/test-env";
import type { ServerStorage } from "@onequery/server/storage";
import { describe, expect, it } from "vitest";

import { createCliApp } from "./app";
import { CLI_REQUEST_ID_HEADER } from "./request-context";

describe("createCliApp", () => {
  it("provides a typed request logger", async () => {
    const runtime = createTestRuntimeConfig();
    expect(runtime.isOk()).toBe(true);
    if (runtime.isErr()) {
      return;
    }

    const app = createCliApp({
      runtime: runtime.value,
      storage: {} as ServerStorage,
    });

    app.get("/typed-logger", (c) =>
      c.json({
        hasLogger: typeof c.var.logger.info === "function",
        requestId: c.var.requestId,
      })
    );

    const response = await app.request("/typed-logger", {
      headers: {
        [CLI_REQUEST_ID_HEADER]: "req_cli_123",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hasLogger: true,
      requestId: "req_cli_123",
    });
  });
});
