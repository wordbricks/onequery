import type { StructuredData } from "@/shared/seo/schema";

export type MetaTag =
  | {
      content: string;
      name: string;
    }
  | {
      content: string;
      property: string;
    };

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
