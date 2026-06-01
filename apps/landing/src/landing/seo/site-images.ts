import { toAbsoluteSiteUrl } from "./structured-data";
import type { StructuredImageMetadata } from "./structured-data";

type SiteInput = string | URL | null | undefined;
type TypedStructuredImageMetadata = StructuredImageMetadata & {
  type: string;
};

export const ONEQUERY_DEFAULT_SHARE_IMAGE_ALT =
  "OneQuery - Governed Data Access for AI Agents";

export const ONEQUERY_PUBLIC_SHARE_IMAGE = {
  height: 630,
  type: "image/png",
  url: "/og.png",
  width: 1200,
} as const satisfies TypedStructuredImageMetadata;

export function getOneQueryPublicShareImageMetadata(
  site?: SiteInput
): TypedStructuredImageMetadata {
  return {
    ...ONEQUERY_PUBLIC_SHARE_IMAGE,
    url: toAbsoluteSiteUrl(ONEQUERY_PUBLIC_SHARE_IMAGE.url, site),
  };
}

export function getOneQueryStructuredShareImageMetadata(
  site?: SiteInput
): TypedStructuredImageMetadata {
  return getOneQueryPublicShareImageMetadata(site);
}
