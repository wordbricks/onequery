export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

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

export function createMarkdownResponse(input: {
  headers?: HeadersInit;
  markdown: string;
  method?: string;
  request?: Pick<Request, "method">;
  status?: number;
  statusText?: string;
}) {
  const headers = new Headers(input.headers);
  const method = input.method ?? input.request?.method ?? "GET";

  headers.set("Content-Type", MARKDOWN_CONTENT_TYPE);
  headers.set(
    "X-Markdown-Tokens",
    String(estimateMarkdownTokens(input.markdown))
  );
  addVaryAccept(headers);

  return new Response(method === "HEAD" ? null : input.markdown, {
    headers,
    status: input.status,
    statusText: input.statusText,
  });
}
