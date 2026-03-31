import { LOCAL_TOPOLOGY } from "@onequery/dev-config/topology";
import { describe, expect, it } from "vitest";

import { resolveViteDevServerConfig } from "@/lib/vite-dev-server-config";

describe("resolveViteDevServerConfig", () => {
  it("uses the dedicated dev browser port instead of the bundled web URL", () => {
    expect(
      resolveViteDevServerConfig({
        BETTER_AUTH_URL: LOCAL_TOPOLOGY.web.bundled.loopbackOrigin,
        WEB_URL: LOCAL_TOPOLOGY.web.bundled.loopbackOrigin,
      })
    ).toEqual({
      apiProxyTarget: LOCAL_TOPOLOGY.web.api.origin,
      port: LOCAL_TOPOLOGY.web.devBrowser.port,
    });
  });

  it("trims surrounding whitespace from the managed web URL", () => {
    expect(
      resolveViteDevServerConfig({
        BETTER_AUTH_URL: LOCAL_TOPOLOGY.web.bundled.origin,
        WEB_URL: `  ${LOCAL_TOPOLOGY.web.bundled.origin}/  `,
      })
    ).toEqual({
      apiProxyTarget: LOCAL_TOPOLOGY.web.api.origin,
      port: LOCAL_TOPOLOGY.web.devBrowser.port,
    });
  });
});
