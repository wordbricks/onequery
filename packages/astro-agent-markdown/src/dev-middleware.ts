import type { MiddlewareHandler } from "astro";

import { getContentMarkdownForPath } from "./content";
import type { ContentMarkdownRoute } from "./content";
import {
  acceptsMarkdown,
  addVaryAccept,
  createMarkdownResponse,
} from "./negotiation";

type SerializedRegExp = readonly [source: string, flags: string];

export type DevMarkdownMiddlewareOptions = {
  contentRoutes?: readonly ContentMarkdownRoute[];
  exclude?: readonly SerializedRegExp[];
};

const DEFAULT_EXCLUDES = [/^\/404(?:\/|$)/u, /^\/_astro(?:\/|$)/u];
const MARKDOWN_METHODS = new Set(["GET", "HEAD"]);

function createExcludePatterns(exclude: readonly SerializedRegExp[] = []) {
  return [
    ...DEFAULT_EXCLUDES,
    ...exclude.map(([source, flags]) => new RegExp(source, flags)),
  ];
}

function isExcluded(pathname: string, excludePatterns: readonly RegExp[]) {
  return excludePatterns.some((pattern) => pattern.test(pathname));
}

function isHtmlResponse(response: Response) {
  return response.headers.get("Content-Type")?.includes("text/html") ?? false;
}

function withVaryAccept(response: Response) {
  const headers = new Headers(response.headers);
  addVaryAccept(headers);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function htmlResponseToMarkdown(response: Response) {
  const { htmlToMarkdown } = await import("./html-to-markdown");
  return htmlToMarkdown(await response.text());
}

export function createDevMarkdownMiddleware(
  options: DevMarkdownMiddlewareOptions = {}
): MiddlewareHandler {
  const excludePatterns = createExcludePatterns(options.exclude);
  const contentRoutes = options.contentRoutes ?? [];

  return async (context, next) => {
    const { request, url } = context;
    const canNegotiate =
      MARKDOWN_METHODS.has(request.method) &&
      acceptsMarkdown(request.headers.get("Accept")) &&
      !isExcluded(url.pathname, excludePatterns);

    if (canNegotiate) {
      const contentMarkdown = await getContentMarkdownForPath({
        contentRoutes,
        pathname: url.pathname,
      });

      if (contentMarkdown !== undefined) {
        return createMarkdownResponse({
          markdown: contentMarkdown,
          request,
        });
      }
    }

    const renderRequest =
      canNegotiate && request.method === "HEAD"
        ? new Request(request, { method: "GET" })
        : undefined;
    const response = renderRequest ? await next(renderRequest) : await next();

    if (!canNegotiate || !isHtmlResponse(response)) {
      return withVaryAccept(response);
    }

    const markdown = await htmlResponseToMarkdown(response);

    return createMarkdownResponse({
      headers: response.headers,
      markdown,
      request,
      status: response.status,
      statusText: response.statusText,
    });
  };
}
