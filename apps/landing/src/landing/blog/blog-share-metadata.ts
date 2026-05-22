import {
  createCanonicalUrl,
  normalizeSiteUrl,
  toAbsoluteSiteUrl,
  toIsoDateTime,
} from "../seo/structured-data";
import type { StructuredImageMetadata } from "../seo/structured-data";
import type { BlogPost } from "./blog-types";

const DEFAULT_BLOG_SHARE_IMAGE = {
  height: 630,
  url: "/og.png",
  width: 1200,
} satisfies StructuredImageMetadata;

export interface BlogPostShareMetadata {
  canonicalUrl: string;
  description: string;
  imageAlt: string;
  imageHeight: number;
  imageWidth: number;
  imageUrl: string;
  publishedTime: string | undefined;
  title: string;
  twitterTitle: string;
}

export function getBlogPostShareMetadata(
  post: Pick<BlogPost, "description" | "slug" | "title" | "publishedAt">,
  site?: string | URL | null,
  image: StructuredImageMetadata = DEFAULT_BLOG_SHARE_IMAGE
): BlogPostShareMetadata {
  const siteUrl = normalizeSiteUrl(site);
  const title = `${post.title} | OneQuery Blog`;
  const imageUrl = toAbsoluteSiteUrl(image.url, siteUrl);

  return {
    canonicalUrl: createCanonicalUrl(`/blog/${post.slug}`, siteUrl),
    description: post.description,
    imageAlt: `${post.title} - OneQuery Blog`,
    imageHeight: image.height,
    imageWidth: image.width,
    imageUrl,
    publishedTime: toIsoDateTime(post.publishedAt),
    title,
    twitterTitle: post.title,
  };
}
