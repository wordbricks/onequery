import type { ImageMetadata } from "astro";
import { getImage } from "astro:assets";

import { ONEQUERY } from "@/shared/seo/constants";
import type { SeoImage } from "@/shared/seo/constants";
import { toAbsoluteSiteUrl } from "@/shared/seo/schema";

import type { BlogPost, BlogPostSummary } from "./types";

const BLOG_SHARE_IMAGE = {
  MAX_RATIO: 2.2,
  MIN_RATIO: 1.45,
  MIN_WIDTH: 1200,
} as const;

function isPreferredShareImage(image: ImageMetadata) {
  const ratio = image.width / image.height;

  return (
    image.width >= BLOG_SHARE_IMAGE.MIN_WIDTH &&
    ratio >= BLOG_SHARE_IMAGE.MIN_RATIO &&
    ratio <= BLOG_SHARE_IMAGE.MAX_RATIO
  );
}

export function getPreferredBlogShareImage(post: Pick<BlogPost, "coverImage">) {
  return isPreferredShareImage(post.coverImage.src)
    ? post.coverImage.src
    : undefined;
}

export async function getBlogShareImage(
  image: ImageMetadata | undefined,
  site?: string | URL | null
): Promise<SeoImage> {
  if (!image) {
    return {
      ...ONEQUERY.IMAGES.SHARE,
      url: toAbsoluteSiteUrl(ONEQUERY.IMAGES.SHARE.url, site),
    };
  }

  const optimizedImage = await getImage({
    format: "png",
    src: image,
  });

  return {
    height: image.height,
    url: toAbsoluteSiteUrl(optimizedImage.src, site),
    width: image.width,
  };
}

export async function getBlogShareImagesBySlug(
  posts: readonly Pick<BlogPostSummary, "coverImage" | "slug">[],
  site?: string | URL | null
): Promise<Record<string, SeoImage>> {
  return Object.fromEntries(
    await Promise.all(
      posts.map(async (post) => [
        post.slug,
        await getBlogShareImage(post.coverImage.src, site),
      ])
    )
  );
}
