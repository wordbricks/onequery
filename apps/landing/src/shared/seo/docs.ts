import { createSeoHeadEntries } from "@onequery/astro-seo";
import type { SeoHeadEntry, SeoHeadMetadata } from "@onequery/astro-seo";

import { ONEQUERY, SEO_PATHS } from "./constants";
import {
  createCanonicalUrl,
  createDocsIndexStructuredData,
  toAbsoluteSiteUrl,
} from "./schema";
import type { SiteInput } from "./schema";

export const DOCS_INDEX_TITLE =
  "OneQuery Documentation | Governed Agent Data Access";
export const DOCS_INDEX_HEADLINE = "OneQuery Documentation";
export const DOCS_INDEX_DESCRIPTION =
  "OneQuery documentation for installing the CLI, connecting governed sources, running read-only queries, and giving agents safe production context.";
export const DOCS_INDEX_KEYWORDS = [
  "OneQuery documentation",
  "AI agent data access",
  "governed data access",
  "read-only queries",
  "Source API",
  "source identifiers",
  "production context",
  "audit history",
  "CLI install",
] as const;

export function createDocsIndexSeoMetadata(site?: SiteInput): SeoHeadMetadata {
  const canonicalUrl = createCanonicalUrl(SEO_PATHS.DOCS, site);
  const image = {
    alt: ONEQUERY.SHARE_IMAGE_ALT,
    height: ONEQUERY.IMAGES.SHARE.height,
    type: ONEQUERY.IMAGES.SHARE.type,
    url: toAbsoluteSiteUrl(ONEQUERY.IMAGES.SHARE.url, site),
    width: ONEQUERY.IMAGES.SHARE.width,
  };

  return {
    canonicalUrl,
    description: DOCS_INDEX_DESCRIPTION,
    image,
    keywords: DOCS_INDEX_KEYWORDS,
    openGraph: {
      locale: "en_US",
      siteName: ONEQUERY.NAME,
      type: "website",
      url: canonicalUrl,
    },
    robots: "index, follow, max-image-preview:large",
    sitemapUrl: "/sitemap-index.xml",
    structuredData: createDocsIndexStructuredData({
      description: DOCS_INDEX_DESCRIPTION,
      site,
      title: DOCS_INDEX_HEADLINE,
    }),
    title: DOCS_INDEX_TITLE,
    twitter: {
      description: DOCS_INDEX_DESCRIPTION,
      image,
      title: DOCS_INDEX_TITLE,
    },
  };
}

export function createDocsIndexHeadEntries(site?: SiteInput): SeoHeadEntry[] {
  return createSeoHeadEntries(createDocsIndexSeoMetadata(site));
}
