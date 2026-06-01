import type { MetaTag, StructuredData } from "@onequery/astro-seo";

export interface PageMetadata {
  canonicalUrl?: string;
  description?: string;
  imageAlt?: string;
  imageHeight?: number;
  imageType?: string;
  imageUrl?: string;
  imageWidth?: number;
  keywords?: string | null;
  metaTags?: MetaTag[];
  ogType?: "article" | "website";
  robots?: string;
  structuredData?: StructuredData | StructuredData[] | null;
  title?: string;
  twitterTitle?: string;
}
