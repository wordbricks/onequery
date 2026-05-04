import { getBlogPostSummaryBySlug } from "./landing/blog/blog-posts";
import {
  getBlogPostShareMetadata,
  renderBlogPostShareTags,
} from "./landing/blog/blog-share-metadata";
import { LANDING_API_PREFIX } from "./landing/config/landing-api";
import { landingApp } from "./server/app";
import type { LandingWorkerBindings } from "./server/app";

type LandingWorkerEnv = CloudflareEnv & LandingWorkerBindings;

const BLOG_POST_PATH_PATTERN = /^\/blog\/([^/]+)\/?$/u;
const SHARE_TAG_ATTRIBUTES = [
  "description",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
  "og:type",
  "og:url",
  "og:site_name",
  "og:title",
  "og:description",
  "og:image",
  "og:image:secure_url",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "article:published_time",
];

function readBlogPostSlug(pathname: string) {
  return BLOG_POST_PATH_PATTERN.exec(pathname)?.[1];
}

function removeExistingShareTag(html: string, attributeValue: string) {
  const tagPattern = new RegExp(
    `<meta\\s+[^>]*(?:name|property)=["']${attributeValue}["'][^>]*>\\s*`,
    "giu"
  );

  return html.replace(tagPattern, "");
}

function injectBlogPostShareTags(html: string, slug: string) {
  const post = getBlogPostSummaryBySlug(slug);

  if (!post) {
    return html;
  }

  const metadata = getBlogPostShareMetadata(post);
  const shareTags = renderBlogPostShareTags(metadata);
  const htmlWithoutStaticShareTags = SHARE_TAG_ATTRIBUTES.reduce(
    removeExistingShareTag,
    html
  )
    .replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>\s*/iu, "")
    .replace(/<title>[\s\S]*?<\/title>\s*/iu, "");

  return htmlWithoutStaticShareTags.replace(
    "</head>",
    `    ${shareTags}\n  </head>`
  );
}

const worker: ExportedHandler<LandingWorkerEnv> = {
  async fetch(
    request: Request,
    env: LandingWorkerEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (
      url.pathname === LANDING_API_PREFIX ||
      url.pathname.startsWith(`${LANDING_API_PREFIX}/`)
    ) {
      return landingApp.fetch(request, env, ctx);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const blogPostSlug = readBlogPostSlug(url.pathname);

    if (
      request.method !== "GET" ||
      !blogPostSlug ||
      !assetResponse.headers.get("content-type")?.includes("text/html")
    ) {
      return assetResponse;
    }

    const headers = new Headers(assetResponse.headers);
    headers.delete("content-length");

    return new Response(
      injectBlogPostShareTags(await assetResponse.text(), blogPostSlug),
      {
        headers,
        status: assetResponse.status,
        statusText: assetResponse.statusText,
      }
    );
  },
};

export default worker;
