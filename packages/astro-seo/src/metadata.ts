import type { StructuredDataInput } from "./json-ld";

export type MetaTag =
  | {
      content: string;
      name: string;
    }
  | {
      content: string;
      property: string;
    };

export type OpenGraphType =
  | "article"
  | "book"
  | "profile"
  | "website"
  | "music.album"
  | "music.playlist"
  | "music.radio_station"
  | "music.song"
  | "video.episode"
  | "video.movie"
  | "video.other"
  | "video.tv_show";

export type TwitterCardType =
  | "app"
  | "player"
  | "summary"
  | "summary_large_image";

export type SeoImageMetadata = {
  alt?: string;
  height?: number;
  secureUrl?: string;
  type?: string;
  url: string;
  width?: number;
};

export type OpenGraphMetadata = {
  description?: string;
  image?: SeoImageMetadata;
  locale?: string;
  siteName?: string;
  title?: string;
  type?: OpenGraphType;
  url?: string;
};

export type TwitterMetadata = {
  card?: TwitterCardType;
  description?: string;
  image?: SeoImageMetadata;
  site?: string;
  title?: string;
};

export type SeoHeadMetadata = {
  applicationName?: string;
  appleMobileWebAppTitle?: string;
  author?: string;
  canonicalUrl: string;
  description: string;
  image?: SeoImageMetadata;
  keywords?: readonly string[] | string | null;
  metaTags?: readonly MetaTag[];
  openGraph?: OpenGraphMetadata;
  robots?: string;
  sitemapUrl?: string | null;
  structuredData?: StructuredDataInput;
  themeColor?: string | null;
  title: string;
  twitter?: TwitterMetadata;
};

export function formatKeywords(
  keywords: readonly string[] | string | null | undefined
) {
  if (!keywords) {
    return undefined;
  }

  const content =
    typeof keywords === "string"
      ? keywords.trim()
      : keywords
          .map((keyword) => keyword.trim())
          .filter(Boolean)
          .join(", ");

  return content.length > 0 ? content : undefined;
}
