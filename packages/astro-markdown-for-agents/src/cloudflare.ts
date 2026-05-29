export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

type AssetFetcher = {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
};

const HTML_FILE_EXTENSION_PATTERN = /\/[^/]+\.[^/]+$/u;

export function acceptsMarkdown(acceptHeader: string | null) {
  if (!acceptHeader) {
    return false;
  }

  return acceptHeader.split(",").some((part) => {
    const [mediaType = "", ...parameters] = part
      .split(";")
      .map((segment) => segment.trim().toLowerCase());
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    const qualityValue = quality ? Number.parseFloat(quality.slice(2)) : 1;

    return mediaType === "text/markdown" && qualityValue > 0;
  });
}

export function addVaryAccept(headers: Headers) {
  const vary = headers.get("Vary");

  if (!vary) {
    headers.set("Vary", "Accept");
    return;
  }

  const values = vary.split(",").map((value) => value.trim().toLowerCase());
  if (!values.includes("accept") && !values.includes("*")) {
    headers.set("Vary", `${vary}, Accept`);
  }
}

export function getMarkdownAssetPath(pathname: string) {
  if (pathname.endsWith(".md") || HTML_FILE_EXTENSION_PATTERN.test(pathname)) {
    return undefined;
  }

  return pathname.endsWith("/")
    ? `${pathname}index.md`
    : `${pathname}/index.md`;
}

export function estimateMarkdownTokens(markdown: string) {
  const trimmedMarkdown = markdown.trim();

  if (trimmedMarkdown.length === 0) {
    return 0;
  }

  return Math.ceil(trimmedMarkdown.length / 4);
}

export async function createNegotiatedMarkdownResponse(input: {
  assets: AssetFetcher;
  request: Request;
}) {
  if (!["GET", "HEAD"].includes(input.request.method)) {
    return undefined;
  }

  if (!acceptsMarkdown(input.request.headers.get("Accept"))) {
    return undefined;
  }

  const requestUrl = new URL(input.request.url);
  const markdownPath = getMarkdownAssetPath(requestUrl.pathname);

  if (!markdownPath) {
    return undefined;
  }

  const markdownUrl = new URL(markdownPath, requestUrl.origin);
  const assetResponse = await input.assets.fetch(markdownUrl.toString());

  if (!assetResponse.ok) {
    return undefined;
  }

  const markdown = await assetResponse.text();
  const headers = new Headers(assetResponse.headers);

  headers.set("Content-Type", MARKDOWN_CONTENT_TYPE);
  headers.set("X-Markdown-Tokens", String(estimateMarkdownTokens(markdown)));
  addVaryAccept(headers);

  return new Response(input.request.method === "HEAD" ? null : markdown, {
    headers,
    status: assetResponse.status,
    statusText: assetResponse.statusText,
  });
}
