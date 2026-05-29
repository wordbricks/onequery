import {
  acceptsMarkdown,
  createMarkdownResponse,
  getMarkdownAssetPath,
} from "./negotiation";

type AssetFetcher = {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
};

export {
  MARKDOWN_CONTENT_TYPE,
  acceptsMarkdown,
  addVaryAccept,
  createMarkdownResponse,
  estimateMarkdownTokens,
  getMarkdownAssetPath,
} from "./negotiation";

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
  return createMarkdownResponse({
    headers: assetResponse.headers,
    markdown,
    request: input.request,
    status: assetResponse.status,
    statusText: assetResponse.statusText,
  });
}
