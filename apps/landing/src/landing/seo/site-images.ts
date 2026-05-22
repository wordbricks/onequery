import { getImage } from "astro:assets";

import oneQueryShareImage from "../../assets/og.png";
import { toAbsoluteSiteUrl } from "./structured-data";
import type { StructuredImageMetadata } from "./structured-data";

type SiteInput = string | URL | null | undefined;
type TypedStructuredImageMetadata = StructuredImageMetadata & {
  type: string;
};

const STRUCTURED_SHARE_IMAGE_QUALITY = 90;

export const ONEQUERY_DEFAULT_SHARE_IMAGE_ALT =
  "OneQuery - Governed Data Access for AI Agents";

export const ONEQUERY_PUBLIC_SHARE_IMAGE = {
  height: oneQueryShareImage.height,
  type: "image/png",
  url: "/og.png",
  width: oneQueryShareImage.width,
} as const satisfies TypedStructuredImageMetadata;

export function getOneQueryPublicShareImageMetadata(
  site?: SiteInput
): TypedStructuredImageMetadata {
  return {
    ...ONEQUERY_PUBLIC_SHARE_IMAGE,
    url: toAbsoluteSiteUrl(ONEQUERY_PUBLIC_SHARE_IMAGE.url, site),
  };
}

export async function getOneQueryStructuredShareImageMetadata(
  site?: SiteInput
): Promise<TypedStructuredImageMetadata> {
  const optimizedImage = await getImage({
    format: "webp",
    height: ONEQUERY_PUBLIC_SHARE_IMAGE.height,
    quality: STRUCTURED_SHARE_IMAGE_QUALITY,
    src: oneQueryShareImage,
    width: ONEQUERY_PUBLIC_SHARE_IMAGE.width,
  });

  return {
    height: ONEQUERY_PUBLIC_SHARE_IMAGE.height,
    type: "image/webp",
    url: toAbsoluteSiteUrl(optimizedImage.src, site),
    width: ONEQUERY_PUBLIC_SHARE_IMAGE.width,
  };
}
