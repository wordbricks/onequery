import type { MiddlewareHandler } from "astro";

import {
  acceptsMarkdown,
  addVaryAccept,
  createMarkdownResponse,
  getMarkdownAssetPath,
} from "./cloudflare";
import { htmlToMarkdown } from "./html-to-markdown";

type SerializedRegExp = readonly [source: string, flags: string];

export type DevMarkdownMiddlewareOptions = {
  exclude?: readonly SerializedRegExp[];
  sourceContentByAssetPath?: Readonly<Record<string, string>>;
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

export function createDevMarkdownMiddleware(
  options: DevMarkdownMiddlewareOptions = {}
): MiddlewareHandler {
  const excludePatterns = createExcludePatterns(options.exclude);
  const sourceContentByAssetPath = options.sourceContentByAssetPath ?? {};

  return async (context, next) => {
    const { request, url } = context;
    const markdownPath = getMarkdownAssetPath(url.pathname);
    const canNegotiate =
      MARKDOWN_METHODS.has(request.method) &&
      acceptsMarkdown(request.headers.get("Accept")) &&
      markdownPath !== undefined &&
      !isExcluded(url.pathname, excludePatterns);

    if (canNegotiate) {
      const sourceMarkdown = sourceContentByAssetPath[markdownPath];

      if (sourceMarkdown !== undefined) {
        return createMarkdownResponse({
          markdown: sourceMarkdown,
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

    const markdown = htmlToMarkdown(await response.text());

    return createMarkdownResponse({
      headers: response.headers,
      markdown,
      request,
      status: response.status,
      statusText: response.statusText,
    });
  };
}
