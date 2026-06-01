import type { ImageMetadata } from "astro";
import { getImage } from "astro:assets";

import { toAbsoluteSiteUrl } from "@/shared/seo/schema";
import type { StructuredImageMetadata } from "@/shared/seo/schema";

import type { BlogPost, BlogPostSummary } from "./types";

const DEFAULT_SHARE_IMAGE: StructuredImageMetadata = {
  height: 630,
  url: "/og.png",
  width: 1200,
};
const MIN_SHARE_IMAGE_WIDTH = 1200;
const MIN_SHARE_IMAGE_RATIO = 1.45;
const MAX_SHARE_IMAGE_RATIO = 2.2;

function getBlogPostImageSources(post: Pick<BlogPost, "coverImage">) {
  return [post.coverImage.src].filter((image): image is ImageMetadata =>
    Boolean(image)
  );
}

function isPreferredShareImage(image: ImageMetadata) {
  const ratio = image.width / image.height;

  return (
    image.width >= MIN_SHARE_IMAGE_WIDTH &&
    ratio >= MIN_SHARE_IMAGE_RATIO &&
    ratio <= MAX_SHARE_IMAGE_RATIO
  );
}

export function getPreferredBlogShareImage(post: Pick<BlogPost, "coverImage">) {
  return getBlogPostImageSources(post).find(isPreferredShareImage);
}

export async function getBlogShareImageMetadata(
  image: ImageMetadata | undefined,
  site?: string | URL | null
): Promise<StructuredImageMetadata> {
  if (!image) {
    return {
      ...DEFAULT_SHARE_IMAGE,
      url: toAbsoluteSiteUrl(DEFAULT_SHARE_IMAGE.url, site),
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

export function getBlogPostShareImageMetadata(
  post: Pick<BlogPost, "coverImage">,
  site?: string | URL | null
) {
  return getBlogShareImageMetadata(getPreferredBlogShareImage(post), site);
}

export async function getBlogShareImageMetadataBySlug(
  posts: readonly Pick<BlogPostSummary, "coverImage" | "slug">[],
  site?: string | URL | null
) {
  return Object.fromEntries(
    await Promise.all(
      posts.map(async (post) => [
        post.slug,
        await getBlogShareImageMetadata(post.coverImage.src, site),
      ])
    )
  );
}
