import type { APIContext, MiddlewareNext } from "astro";
import { describe, expect, it, vi } from "vitest";

import { MARKDOWN_CONTENT_TYPE } from "./cloudflare";
import { contentEntryToMarkdown } from "./content";
import { createDevMarkdownMiddleware } from "./dev-middleware";

function createContext(request: Request): APIContext {
  return {
    request,
    url: new URL(request.url),
  } as APIContext;
}

describe("createDevMarkdownMiddleware", () => {
  it("returns content collection Markdown before rendering when an entry matches", async () => {
    const onRequest = createDevMarkdownMiddleware({
      contentRoutes: [
        {
          getMarkdown: async (entryId) =>
            entryId === "debug-production-agent-runs-with-onequery"
              ? contentEntryToMarkdown({
                  body: "## Evidence\n",
                  frontmatter: { title: "Debugging production" },
                })
              : undefined,
          routePrefix: "/blog",
        },
      ],
    });
    const next = vi.fn(async () => new Response("should not render"));

    const response = await onRequest(
      createContext(
        new Request(
          "http://localhost:4546/blog/debug-production-agent-runs-with-onequery/index.md"
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

  it("passes HTML responses through without request header negotiation", async () => {
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
      createContext(new Request("http://localhost:4546/connectors/")),
      next as unknown as MiddlewareNext
    );

    expect(response).toBeInstanceOf(Response);
    expect(next).toHaveBeenCalledWith();

    const htmlResponse = response as Response;
    expect(htmlResponse.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8"
    );
    expect(htmlResponse.headers.get("Vary")).toBe("Accept");
    expect(await htmlResponse.text()).toBe(
      "<main><h1>OneQuery</h1><p>Context, not keys.</p></main>"
    );
  });

  it("keeps HEAD responses as pass-through responses outside content routes", async () => {
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
          method: "HEAD",
        })
      ),
      next as unknown as MiddlewareNext
    );

    expect(next).toHaveBeenCalledWith();
    expect(response).toBeInstanceOf(Response);

    const htmlResponse = response as Response;
    expect(htmlResponse.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8"
    );
    expect(htmlResponse.headers.get("Vary")).toBe("Accept");
    expect(await htmlResponse.text()).toBe(
      "<main><h1>OneQuery</h1><p>Context, not keys.</p></main>"
    );
  });

  it("does not read prerendered request headers for ordinary HTML requests", async () => {
    const onRequest = createDevMarkdownMiddleware();
    const next = vi.fn(
      async () => new Response("<main><h1>OneQuery</h1></main>")
    );
    const request = new Request("http://localhost:4546/docs/getting-started/");
    Object.defineProperty(request, "headers", {
      get() {
        throw new Error(
          "headers should not be read for ordinary HTML requests"
        );
      },
    });

    const response = await onRequest(
      createContext(request),
      next as unknown as MiddlewareNext
    );

    expect(response).toBeInstanceOf(Response);
    expect(response?.headers.get("Vary")).toBe("Accept");
  });
});
