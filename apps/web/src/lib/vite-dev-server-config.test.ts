import {
  LOCAL_WEB_API_DEV_ORIGIN,
  LOCAL_WEB_PORT,
} from "@onequery/dev-config/topology";
import { describe, expect, it } from "vitest";

import { resolveViteDevServerConfig } from "@/lib/vite-dev-server-config";

describe("resolveViteDevServerConfig", () => {
  it("uses the explicit port from the managed web URL", () => {
    expect(
      resolveViteDevServerConfig({
        BETTER_AUTH_URL: `http://127.0.0.1:${LOCAL_WEB_PORT}`,
        WEB_URL: `http://127.0.0.1:${LOCAL_WEB_PORT}`,
      })
    ).toEqual({
      apiProxyTarget: LOCAL_WEB_API_DEV_ORIGIN,
      port: LOCAL_WEB_PORT,
    });
  });

  it("trims surrounding whitespace from the managed web URL", () => {
    expect(
      resolveViteDevServerConfig({
        BETTER_AUTH_URL: `http://localhost:${LOCAL_WEB_PORT}`,
        WEB_URL: `  http://localhost:${LOCAL_WEB_PORT}/  `,
      })
    ).toEqual({
      apiProxyTarget: LOCAL_WEB_API_DEV_ORIGIN,
      port: LOCAL_WEB_PORT,
    });
  });
});
