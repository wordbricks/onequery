import type { APIContext, MiddlewareNext } from "astro";
import { describe, expect, it, vi } from "vitest";

import { MARKDOWN_CONTENT_TYPE } from "./cloudflare";
import { createDevMarkdownMiddleware } from "./dev-middleware";

function createContext(request: Request): APIContext {
  return {
    request,
    url: new URL(request.url),
  } as APIContext;
}

describe("createDevMarkdownMiddleware", () => {
  it("returns source Markdown before rendering when a source sidecar exists", async () => {
    const onRequest = createDevMarkdownMiddleware({
      sourceContentByAssetPath: {
        "/blog/debug-production-agent-runs-with-onequery/index.md":
          "---\ntitle: Debugging production\n---\n\n## Evidence\n",
      },
    });
    const next = vi.fn(async () => new Response("should not render"));

    const response = await onRequest(
      createContext(
        new Request(
          "http://localhost:4546/blog/debug-production-agent-runs-with-onequery/",
          {
            headers: { Accept: "text/markdown" },
          }
        )
      ),
      next as unknown as MiddlewareNext
    );

    expect(next).not.toHaveBeenCalled();
    expect(response).toBeInstanceOf(Response);

    const markdownResponse = response as Response;
    expect(markdownResponse.headers.get("Content-Type")).toBe(
      MARKDOWN_CONTENT_TYPE
    );
    expect(markdownResponse.headers.get("X-Markdown-Tokens")).toBe("12");
    expect(await markdownResponse.text()).toContain("## Evidence");
  });

  it("converts HTML responses to Markdown during local development", async () => {
    const onRequest = createDevMarkdownMiddleware();
    const next = vi.fn(
      async () =>
        new Response(
          "<main><h1>OneQuery</h1><p>Context, not keys.</p></main>",
          {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        )
    );

    const response = await onRequest(
      createContext(
        new Request("http://localhost:4546/connectors/", {
          headers: { Accept: "text/markdown" },
        })
      ),
      next as unknown as MiddlewareNext
    );

    expect(response).toBeInstanceOf(Response);

    const markdownResponse = response as Response;
    expect(markdownResponse.headers.get("Content-Type")).toBe(
      MARKDOWN_CONTENT_TYPE
    );
    expect(markdownResponse.headers.get("X-Markdown-Tokens")).toBe("8");
    expect(await markdownResponse.text()).toBe(`# OneQuery

Context, not keys.
`);
  });

  it("renders HTML-derived HEAD requests with GET so token counts are available", async () => {
    const onRequest = createDevMarkdownMiddleware();
    const next = vi.fn(
      async () =>
        new Response(
          "<main><h1>OneQuery</h1><p>Context, not keys.</p></main>",
          {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }
        )
    );

    const response = await onRequest(
      createContext(
        new Request("http://localhost:4546/", {
          headers: { Accept: "text/markdown" },
          method: "HEAD",
        })
      ),
      next as unknown as MiddlewareNext
    );

    expect(next).toHaveBeenCalledWith(expect.any(Request));
    expect(response).toBeInstanceOf(Response);

    const markdownResponse = response as Response;
    expect(markdownResponse.headers.get("Content-Type")).toBe(
      MARKDOWN_CONTENT_TYPE
    );
    expect(markdownResponse.headers.get("X-Markdown-Tokens")).toBe("8");
    expect(await markdownResponse.text()).toBe("");
  });
});
