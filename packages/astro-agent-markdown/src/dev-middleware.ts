import type { MiddlewareHandler } from "astro";

import { getContentMarkdownForPath } from "./content";
import type { ContentMarkdownRoute } from "./content";
import { addVaryAccept, createMarkdownResponse } from "./negotiation";

type SerializedRegExp = readonly [source: string, flags: string];

export type DevMarkdownMiddlewareOptions = {
  contentRoutes?: readonly ContentMarkdownRoute[];
  exclude?: readonly SerializedRegExp[];
};

const DEFAULT_EXCLUDES = [/^\/404(?:\/|$)/u, /^\/_astro(?:\/|$)/u];
const MARKDOWN_METHODS = new Set(["GET", "HEAD"]);
const MARKDOWN_INDEX_SUFFIX = "/index.md";

function createExcludePatterns(exclude: readonly SerializedRegExp[] = []) {
  return [
    ...DEFAULT_EXCLUDES,
    ...exclude.map(([source, flags]) => new RegExp(source, flags)),
  ];
}

function isExcluded(pathname: string, excludePatterns: readonly RegExp[]) {
  return excludePatterns.some((pattern) => pattern.test(pathname));
}

function getExplicitMarkdownPagePath(pathname: string) {
  if (pathname === "/index.md") {
    return "/";
  }

  if (!pathname.endsWith(MARKDOWN_INDEX_SUFFIX)) {
    return undefined;
  }

  return pathname.slice(0, -MARKDOWN_INDEX_SUFFIX.length + 1);
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

export function createDevMarkdownMiddleware(
  options: DevMarkdownMiddlewareOptions = {}
): MiddlewareHandler {
  const excludePatterns = createExcludePatterns(options.exclude);
  const contentRoutes = options.contentRoutes ?? [];

  return async (context, next) => {
    const { request, url } = context;
    const pagePath = getExplicitMarkdownPagePath(url.pathname);
    const canNegotiate =
      MARKDOWN_METHODS.has(request.method) &&
      pagePath !== undefined &&
      !isExcluded(pagePath, excludePatterns);

    if (canNegotiate) {
      const contentMarkdown = await getContentMarkdownForPath({
        contentRoutes,
        pathname: pagePath,
      });

      if (contentMarkdown !== undefined) {
        return createMarkdownResponse({
          markdown: contentMarkdown,
          method: request.method,
        });
      }
    }

    const response = await next();
    return withVaryAccept(response);
  };
}
