import type { ImageMetadata } from "astro";
import { getImage } from "astro:assets";

import { toAbsoluteSiteUrl } from "../seo/structured-data";
import type { StructuredImageMetadata } from "../seo/structured-data";
import type { BlogPost, BlogPostSummary } from "./blog-types";

const DEFAULT_SHARE_IMAGE: StructuredImageMetadata = {
  height: 630,
  url: "/og.png",
  width: 1200,
};
const MIN_SHARE_IMAGE_WIDTH = 1200;
const MIN_SHARE_IMAGE_RATIO = 1.45;
const MAX_SHARE_IMAGE_RATIO = 2.2;

const blogImageModules = import.meta.glob<ImageMetadata>(
  "../../assets/blog/*.{avif,jpeg,jpg,png,webp}",
  { eager: true, import: "default" }
);

const blogImagesByContentPath = new Map(
  Object.entries(blogImageModules).map(([path, image]) => {
    const filename = path.split("/").at(-1);
    return [`/images/blog/${filename}`, image];
  })
);

export function getBlogImageAsset(src: string | undefined) {
  return src ? blogImagesByContentPath.get(src) : undefined;
}

function getBlogPostImageSources(
  post: Pick<BlogPost, "imageSrc" | "sections">
) {
  const sectionSources =
    post.sections?.flatMap((section) => [
      section.imageSrc,
      ...(section.inlineImages?.map((image) => image.src) ?? []),
      ...(section.images?.map((image) => image.src) ?? []),
    ]) ?? [];

  return [...sectionSources, post.imageSrc].filter(
    (src): src is string => typeof src === "string" && src.length > 0
  );
}

function isPreferredShareImage(src: string) {
  const image = getBlogImageAsset(src);

  if (!image) {
    return false;
  }

  const ratio = image.width / image.height;

  return (
    image.width >= MIN_SHARE_IMAGE_WIDTH &&
    ratio >= MIN_SHARE_IMAGE_RATIO &&
    ratio <= MAX_SHARE_IMAGE_RATIO
  );
}

export function getPreferredBlogShareImageSrc(
  post: Pick<BlogPost, "imageSrc" | "sections">
) {
  return getBlogPostImageSources(post).find(isPreferredShareImage);
}

export async function getBlogShareImageMetadata(
  src: string | undefined,
  site?: string | URL | null
): Promise<StructuredImageMetadata> {
  const image = getBlogImageAsset(src);

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
  post: Pick<BlogPost, "imageSrc" | "sections">,
  site?: string | URL | null
) {
  return getBlogShareImageMetadata(getPreferredBlogShareImageSrc(post), site);
}

export async function getBlogShareImageMetadataBySlug(
  posts: readonly Pick<BlogPostSummary, "imageSrc" | "slug">[],
  site?: string | URL | null
) {
  return Object.fromEntries(
    await Promise.all(
      posts.map(async (post) => [
        post.slug,
        await getBlogShareImageMetadata(post.imageSrc, site),
      ])
    )
  );
}
