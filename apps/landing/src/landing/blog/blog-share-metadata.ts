import type { BlogPost } from "./blog-types";

const ONEQUERY_SITE_URL = "https://onequery.dev";
const ONEQUERY_SITE_NAME = "OneQuery";
const BLOG_SHARE_IMAGE_SIZE = 1254;

interface BlogPostShareMetadata {
  canonicalUrl: string;
  description: string;
  imageAlt: string;
  imageHeight: number;
  imageUrl: string;
  publishedTime: string | undefined;
  title: string;
  twitterTitle: string;
}

type BlogPostHeadMeta = (
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string }
)[];

function toAbsoluteOneQueryUrl(pathOrUrl: string) {
  if (/^https?:\/\//u.test(pathOrUrl)) {
    return pathOrUrl;
  }

  return `${ONEQUERY_SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function toIsoDate(date: string) {
  const timestamp = Date.parse(date);

  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  return new Date(timestamp).toISOString();
}

export function getBlogPostShareMetadata(
  post: Pick<BlogPost, "description" | "imageSrc" | "slug" | "title" | "date">
): BlogPostShareMetadata {
  const title = `${post.title} | OneQuery Blog`;
  const imageUrl = toAbsoluteOneQueryUrl(post.imageSrc ?? "/og.png");

  return {
    canonicalUrl: `${ONEQUERY_SITE_URL}/blog/${post.slug}`,
    description: post.description,
    imageAlt: `${post.title} - OneQuery Blog`,
    imageHeight: BLOG_SHARE_IMAGE_SIZE,
    imageUrl,
    publishedTime: toIsoDate(post.date),
    title,
    twitterTitle: post.title,
  };
}

export function getBlogPostHeadMeta(post: BlogPost): BlogPostHeadMeta {
  const metadata = getBlogPostShareMetadata(post);

  return [
    { title: metadata.title },
    { name: "description", content: metadata.description },
    { property: "og:type", content: "article" },
    { property: "og:site_name", content: ONEQUERY_SITE_NAME },
    { property: "og:title", content: metadata.title },
    { property: "og:description", content: metadata.description },
    { property: "og:url", content: metadata.canonicalUrl },
    { property: "og:image", content: metadata.imageUrl },
    { property: "og:image:secure_url", content: metadata.imageUrl },
    { property: "og:image:width", content: String(BLOG_SHARE_IMAGE_SIZE) },
    { property: "og:image:height", content: String(metadata.imageHeight) },
    { property: "og:image:alt", content: metadata.imageAlt },
    {
      property: "article:published_time",
      content: metadata.publishedTime ?? "",
    },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: metadata.twitterTitle },
    { name: "twitter:description", content: metadata.description },
    { name: "twitter:image", content: metadata.imageUrl },
    { name: "twitter:image:alt", content: metadata.imageAlt },
  ].filter(
    (entry) =>
      !("content" in entry) ||
      typeof entry.content !== "string" ||
      entry.content.length > 0
  );
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderMetaTag(
  attribute: "name" | "property",
  key: string,
  content: string
) {
  return `<meta ${attribute}="${escapeHtmlAttribute(key)}" content="${escapeHtmlAttribute(content)}" />`;
}

export function renderBlogPostShareTags(metadata: BlogPostShareMetadata) {
  const tags = [
    `<title>${escapeHtmlAttribute(metadata.title)}</title>`,
    `<link rel="canonical" href="${escapeHtmlAttribute(metadata.canonicalUrl)}" />`,
    renderMetaTag("name", "description", metadata.description),
    renderMetaTag("property", "og:type", "article"),
    renderMetaTag("property", "og:site_name", ONEQUERY_SITE_NAME),
    renderMetaTag("property", "og:title", metadata.title),
    renderMetaTag("property", "og:description", metadata.description),
    renderMetaTag("property", "og:url", metadata.canonicalUrl),
    renderMetaTag("property", "og:image", metadata.imageUrl),
    renderMetaTag("property", "og:image:secure_url", metadata.imageUrl),
    renderMetaTag("property", "og:image:width", String(BLOG_SHARE_IMAGE_SIZE)),
    renderMetaTag("property", "og:image:height", String(metadata.imageHeight)),
    renderMetaTag("property", "og:image:alt", metadata.imageAlt),
    ...(metadata.publishedTime
      ? [
          renderMetaTag(
            "property",
            "article:published_time",
            metadata.publishedTime
          ),
        ]
      : []),
    renderMetaTag("name", "twitter:card", "summary_large_image"),
    renderMetaTag("name", "twitter:title", metadata.twitterTitle),
    renderMetaTag("name", "twitter:description", metadata.description),
    renderMetaTag("name", "twitter:image", metadata.imageUrl),
    renderMetaTag("name", "twitter:image:alt", metadata.imageAlt),
  ];

  return tags.join("\n    ");
}
