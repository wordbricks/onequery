import { describe, expect, it } from "vitest";

import {
  CANONICAL_REDIRECT_STATUS,
  createCanonicalRedirectUrl,
  getCanonicalPathRedirect,
} from "./canonical-routing";

describe("canonical routing", () => {
  it("leaves Cloudflare-owned trailing slash normalization alone", () => {
    expect(getCanonicalPathRedirect("/")).toBeUndefined();
    expect(getCanonicalPathRedirect("/blog")).toBeUndefined();
    expect(getCanonicalPathRedirect("/blog/")).toBeUndefined();
    expect(
      getCanonicalPathRedirect("/blog/context-enrichment-with-onequery")
    ).toBeUndefined();
    expect(
      getCanonicalPathRedirect("/blog/context-enrichment-with-onequery/")
    ).toBeUndefined();
  });

  it("redirects index.html variants to the canonical path", () => {
    expect(getCanonicalPathRedirect("/index.html")).toEqual({ pathname: "/" });
    expect(getCanonicalPathRedirect("/blog/index.html")).toEqual({
      pathname: "/blog/",
    });
  });

  it("redirects removed archive routes to canonical index pages", () => {
    expect(getCanonicalPathRedirect("/blog/archive")).toEqual({
      pathname: "/blog/",
    });
    expect(getCanonicalPathRedirect("/blog/category/product/archive/")).toEqual(
      {
        pathname: "/blog/category/product/",
      }
    );
  });

  it("preserves query strings when creating redirect URLs", () => {
    expect(
      createCanonicalRedirectUrl(
        "https://onequery.dev/blog/index.html?utm_source=test"
      )?.href
    ).toBe("https://onequery.dev/blog/?utm_source=test");
    expect(
      createCanonicalRedirectUrl("https://onequery.dev/blog/?utm_source=test")
        ?.href
    ).toBeUndefined();
    expect(
      createCanonicalRedirectUrl(
        "https://onequery.dev/blog/category/product/index.html?ref=docs"
      )?.href
    ).toBe("https://onequery.dev/blog/category/product/?ref=docs");
  });

  it("uses a permanent method-preserving redirect status", () => {
    expect(CANONICAL_REDIRECT_STATUS).toBe(308);
  });
});
