import { describe, expect, it, vi } from "vitest";

import {
  MARKDOWN_CONTENT_TYPE,
  acceptsMarkdown,
  createNegotiatedMarkdownResponse,
  getMarkdownAssetPath,
} from "./cloudflare";

describe("markdown negotiation", () => {
  it("detects explicit text/markdown accept headers", () => {
    expect(acceptsMarkdown("text/markdown")).toBe(true);
    expect(acceptsMarkdown("text/html, text/markdown;q=0.8")).toBe(true);
    expect(acceptsMarkdown("text/markdown;q=0")).toBe(false);
    expect(acceptsMarkdown("text/html")).toBe(false);
  });

  it("maps canonical page paths to Markdown sidecars", () => {
    expect(getMarkdownAssetPath("/")).toBe("/index.md");
    expect(getMarkdownAssetPath("/connectors/")).toBe("/connectors/index.md");
    expect(getMarkdownAssetPath("/blog")).toBe("/blog/index.md");
    expect(getMarkdownAssetPath("/og.png")).toBeUndefined();
  });

  it("returns Markdown with negotiation headers", async () => {
    const assets = {
      fetch: vi.fn(async () => new Response("# OneQuery\n")),
    };

    const response = await createNegotiatedMarkdownResponse({
      assets,
      request: new Request("https://onequery.dev/connectors/", {
        headers: { Accept: "text/markdown" },
      }),
    });

    expect(assets.fetch).toHaveBeenCalledWith(
      "https://onequery.dev/connectors/index.md"
    );
    expect(response?.headers.get("Content-Type")).toBe(MARKDOWN_CONTENT_TYPE);
    expect(response?.headers.get("Vary")).toBe("Accept");
    expect(response?.headers.get("X-Markdown-Tokens")).toBe("3");
    expect(await response?.text()).toBe("# OneQuery\n");
  });

  it("omits the Markdown body for HEAD requests", async () => {
    const response = await createNegotiatedMarkdownResponse({
      assets: {
        fetch: vi.fn(async () => new Response("# OneQuery\n")),
      },
      request: new Request("https://onequery.dev/", {
        headers: { Accept: "text/markdown" },
        method: "HEAD",
      }),
    });

    expect(response?.headers.get("Content-Type")).toBe(MARKDOWN_CONTENT_TYPE);
    expect(await response?.text()).toBe("");
  });
});
