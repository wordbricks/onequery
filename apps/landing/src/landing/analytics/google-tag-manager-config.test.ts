import { describe, expect, it } from "vitest";

import {
  GOOGLE_TAG_MANAGER_CONTAINER,
  GOOGLE_TAG_MANAGER_DOMAIN,
  readGoogleTagManagerConfig,
} from "./google-tag-manager-config";
import {
  createGoogleTagManagerAfterSwapScript,
  createGoogleTagManagerScript,
} from "./google-tag-manager-script";

describe("readGoogleTagManagerConfig", () => {
  it("returns null when no GTM ID is configured", () => {
    expect(readGoogleTagManagerConfig({})).toBeNull();
    expect(
      readGoogleTagManagerConfig({ PUBLIC_GOOGLE_TAG_MANAGER_ID: "   " })
    ).toBeNull();
  });

  it("trims the container ID and applies the GTM endpoint", () => {
    expect(
      readGoogleTagManagerConfig({
        PUBLIC_GOOGLE_TAG_MANAGER_ID: " GTM-ABC123 ",
      })
    ).toEqual({
      container: GOOGLE_TAG_MANAGER_CONTAINER,
      domain: GOOGLE_TAG_MANAGER_DOMAIN,
      id: "GTM-ABC123",
    });
  });
});

describe("createGoogleTagManagerScript", () => {
  it("includes the GTM loader", () => {
    const script = createGoogleTagManagerScript({
      container: GOOGLE_TAG_MANAGER_CONTAINER,
      domain: GOOGLE_TAG_MANAGER_DOMAIN,
      id: "GTM-ABC123",
    });

    expect(script).toContain("gtm.js");
    expect(script).toContain("GTM-ABC123");
  });

  it("escapes inline script values that could close the script tag", () => {
    const script = createGoogleTagManagerScript({
      container: "gtm.js",
      domain: "https://analytics.example.com/<script>",
      id: "GTM-ABC123</script>",
    });

    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
    expect(script).toContain("\\u003cscript>");
  });
});

describe("createGoogleTagManagerAfterSwapScript", () => {
  it("pushes a virtual pageview through dataLayer on Astro route swaps", () => {
    const script = createGoogleTagManagerAfterSwapScript();

    expect(script).toContain("astro:after-swap");
    expect(script).toContain("dataLayer.push");
    expect(script).toContain("virtualPageview");
  });
});
