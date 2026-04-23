import { createTestRuntimeConfig } from "@onequery/server/routes/test-env";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app";

function createTestApp(
  overrides: Parameters<typeof createTestRuntimeConfig>[0] = {}
) {
  const runtime = createTestRuntimeConfig(overrides);
  const spaAssets = {
    fetch: vi.fn(
      async () =>
        new Response("<!doctype html><title>spa</title>", {
          headers: {
            "content-type": "text/html;charset=utf-8",
          },
        })
    ),
  };

  expect(runtime.isOk()).toBe(true);
  if (runtime.isErr()) {
    return {
      app: null,
      spaAssets,
    };
  }

  return {
    app: createApp({
      runtime: runtime.value,
      spaAssets,
    }),
    spaAssets,
  };
}

describe("runtime app", () => {
  const originalConsoleLog = console.log;

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it("serves the SPA shell and API routes from the same app", async () => {
    console.log = () => {};
    const { app, spaAssets } = createTestApp();
    if (!app) {
      return;
    }
    const rootResponse = await app.fetch(new Request("http://local/"));
    const healthResponse = await app.fetch(
      new Request("http://local/api/health")
    );

    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get("content-type")).toContain("text/html");
    await expect(rootResponse.text()).resolves.toContain("<title>spa</title>");

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({
      status: "ok",
    });

    expect(spaAssets.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns an API 404 instead of the SPA shell for missing API paths", async () => {
    console.log = () => {};
    const { app, spaAssets } = createTestApp();
    if (!app) {
      return;
    }
    const response = await app.fetch(new Request("http://local/api/missing"));

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("404 Not Found");
    expect(spaAssets.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the SPA shell for non-api client routes", async () => {
    console.log = () => {};
    const { app, spaAssets } = createTestApp();
    if (!app) {
      return;
    }
    const response = await app.fetch(
      new Request("http://local/settings/profile")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(spaAssets.fetch).toHaveBeenCalledTimes(1);
  });

  it("serves the installer script for curl-like root requests before the SPA shell", async () => {
    console.log = () => {};
    const { app, spaAssets } = createTestApp();
    if (!app) {
      return;
    }
    const response = await app.fetch(
      new Request("http://local/", {
        headers: {
          "user-agent": "curl/8.7.1",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "text/x-shellscript"
    );
    await expect(response.text()).resolves.toContain(
      'install_bundle_url="$RELEASE_BASE_URL/onequery-install-$platform_tag.tgz"'
    );
    expect(spaAssets.fetch).not.toHaveBeenCalled();
  });

  it("keeps actual CLI Connect requests out of the normal API budget", async () => {
    console.log = () => {};
    const { app } = createTestApp({
      rateLimit: {
        enabled: true,
      },
    });
    if (!app) {
      return;
    }

    for (let index = 0; index < 100; index += 1) {
      const cliResponse = await app.fetch(
        new Request(
          "http://local/api/cli/onequery.cli.v1.CliAuthService/GetSession",
          {
            body: "{}",
            headers: {
              "content-type": "application/json",
            },
            method: "POST",
          }
        )
      );

      expect(cliResponse.status).not.toBe(429);
    }

    const apiResponse = await app.fetch(
      new Request("http://local/api/missing")
    );

    expect(apiResponse.status).toBe(404);
    await expect(apiResponse.text()).resolves.toBe("404 Not Found");
  });

  it("returns machine-readable JSON when the API rate limit is exceeded", async () => {
    console.log = () => {};
    const { app } = createTestApp({
      rateLimit: {
        enabled: true,
      },
    });
    if (!app) {
      return;
    }

    let lastResponse: Response | null = null;
    for (let index = 0; index < 101; index += 1) {
      lastResponse = await app.fetch(new Request("http://local/api/missing"));
    }

    expect(lastResponse?.status).toBe(429);
    expect(lastResponse?.headers.get("content-type")).toContain(
      "application/json"
    );
    await expect(lastResponse?.json()).resolves.toMatchObject({
      error: {
        code: "rate_limited",
        message: "Too many requests, please try again later.",
      },
    });
  });
});
