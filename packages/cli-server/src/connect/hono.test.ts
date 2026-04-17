import { createTestRuntimeConfig } from "@onequery/server/routes/test-env";
import type { ServerStorage } from "@onequery/server/storage";
import { describe, expect, it } from "vitest";

import { createCliRoute } from "./hono";

describe("cli connect hono routing", () => {
  it("registers the Connect methods as concrete Hono routes", () => {
    const app = createCliRoute({
      requestPathPrefix: "/api/cli",
      runtime: createTestRuntimeConfig(),
      storage: {} as ServerStorage,
    });

    const routes = app.routes.map((route) => `${route.method} ${route.path}`);

    expect(routes).toContain("ALL /onequery.cli.v1.CliService/GetSession");
    expect(routes).toContain("ALL /onequery.cli.v1.CliService/ExecuteQuery");
  });
});
