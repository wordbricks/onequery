import { createTestRuntimeConfig } from "@onequery/server/routes/test-env";
import type { ServerStorage } from "@onequery/server/storage";
import { describe, expect, it } from "vitest";

import { createCliRoute } from "./hono";

describe("cli connect hono routing", () => {
  it("registers the Connect methods as concrete Hono routes", () => {
    const runtime = createTestRuntimeConfig();

    expect(runtime.isOk()).toBe(true);
    if (runtime.isErr()) {
      return;
    }

    const app = createCliRoute({
      requestPathPrefix: "/api/cli",
      runtime: runtime.value,
      storage: {} as ServerStorage,
    });

    const routes = app.routes.map((route) => `${route.method} ${route.path}`);

    expect(routes).toContain("ALL /onequery.cli.v1.CliAuthService/GetSession");
    expect(routes).toContain(
      "ALL /onequery.cli.v1.CliOrganizationService/ListOrganizations"
    );
    expect(routes).toContain(
      "ALL /onequery.cli.v1.CliSourceService/ListSources"
    );
    expect(routes).toContain(
      "ALL /onequery.cli.v1.CliQueryService/ExecuteQuery"
    );
    expect(routes).toContain(
      "ALL /onequery.cli.v1.CliSourceApiService/DescribeSourceApi"
    );
  });
});
