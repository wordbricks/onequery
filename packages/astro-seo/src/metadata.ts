import { safeJsonLdStringify, toStructuredDataItems } from "./json-ld";
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

export type SeoHeadAttrs = Record<string, boolean | string | undefined>;

export type SeoHeadEntry =
  | {
      attrs?: never;
      content: string;
      tag: "title";
    }
  | {
      attrs: SeoHeadAttrs;
      content?: never;
      tag: "link" | "meta";
    }
  | {
      attrs: SeoHeadAttrs;
      content: string;
      tag: "script";
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

export function createSeoHeadEntries(
  metadata: SeoHeadMetadata
): SeoHeadEntry[] {
  const {
    applicationName,
    appleMobileWebAppTitle,
    author,
    canonicalUrl,
    description,
    image,
    keywords,
    metaTags = [],
    openGraph = {},
    robots,
    sitemapUrl,
    structuredData,
    themeColor,
    title,
    twitter = {},
  } = metadata;
  const keywordContent = formatKeywords(keywords);
  const ogTitle = openGraph.title ?? title;
  const ogDescription = openGraph.description ?? description;
  const ogUrl = openGraph.url ?? canonicalUrl;
  const ogImage = openGraph.image ?? image;
  const twitterTitle = twitter.title ?? title;
  const twitterDescription = twitter.description ?? description;
  const twitterImage = twitter.image ?? image;
  const entries: SeoHeadEntry[] = [{ tag: "title", content: title }];

  if (themeColor) {
    entries.push({
      tag: "meta",
      attrs: { name: "theme-color", content: themeColor },
    });
  }

  if (robots) {
    entries.push({
      tag: "meta",
      attrs: { name: "robots", content: robots },
    });
  }

  if (author) {
    entries.push({ tag: "meta", attrs: { name: "author", content: author } });
  }

  if (applicationName) {
    entries.push({
      tag: "meta",
      attrs: { name: "application-name", content: applicationName },
    });
  }

  if (appleMobileWebAppTitle) {
    entries.push({
      tag: "meta",
      attrs: {
        name: "apple-mobile-web-app-title",
        content: appleMobileWebAppTitle,
      },
    });
  }

  entries.push({
    tag: "link",
    attrs: { rel: "canonical", href: canonicalUrl },
  });

  if (sitemapUrl) {
    entries.push({ tag: "link", attrs: { rel: "sitemap", href: sitemapUrl } });
  }

  entries.push({
    tag: "meta",
    attrs: { name: "description", content: description },
  });

  if (keywordContent) {
    entries.push({
      tag: "meta",
      attrs: { name: "keywords", content: keywordContent },
    });
  }

  entries.push(
    { tag: "meta", attrs: { property: "og:title", content: ogTitle } },
    {
      tag: "meta",
      attrs: { property: "og:description", content: ogDescription },
    }
  );

  if (openGraph.type) {
    entries.push({
      tag: "meta",
      attrs: { property: "og:type", content: openGraph.type },
    });
  }

  entries.push({
    tag: "meta",
    attrs: { property: "og:url", content: ogUrl },
  });

  if (openGraph.siteName) {
    entries.push({
      tag: "meta",
      attrs: { property: "og:site_name", content: openGraph.siteName },
    });
  }

  if (openGraph.locale) {
    entries.push({
      tag: "meta",
      attrs: { property: "og:locale", content: openGraph.locale },
    });
  }

  if (ogImage) {
    entries.push(
      { tag: "meta", attrs: { property: "og:image", content: ogImage.url } },
      {
        tag: "meta",
        attrs: {
          property: "og:image:secure_url",
          content: ogImage.secureUrl ?? ogImage.url,
        },
      }
    );
  }

  if (ogImage?.type) {
    entries.push({
      tag: "meta",
      attrs: { property: "og:image:type", content: ogImage.type },
    });
  }

  if (ogImage?.width) {
    entries.push({
      tag: "meta",
      attrs: { property: "og:image:width", content: String(ogImage.width) },
    });
  }

  if (ogImage?.height) {
    entries.push({
      tag: "meta",
      attrs: { property: "og:image:height", content: String(ogImage.height) },
    });
  }

  if (ogImage?.alt) {
    entries.push({
      tag: "meta",
      attrs: { property: "og:image:alt", content: ogImage.alt },
    });
  }

  entries.push({
    tag: "meta",
    attrs: {
      name: "twitter:card",
      content: twitter.card ?? "summary_large_image",
    },
  });

  if (twitter.site) {
    entries.push({
      tag: "meta",
      attrs: { name: "twitter:site", content: twitter.site },
    });
  }

  entries.push(
    { tag: "meta", attrs: { name: "twitter:title", content: twitterTitle } },
    {
      tag: "meta",
      attrs: { name: "twitter:description", content: twitterDescription },
    }
  );

  if (twitterImage) {
    entries.push({
      tag: "meta",
      attrs: { name: "twitter:image", content: twitterImage.url },
    });
  }

  if (twitterImage?.alt) {
    entries.push({
      tag: "meta",
      attrs: { name: "twitter:image:alt", content: twitterImage.alt },
    });
  }

  for (const tag of metaTags) {
    entries.push({
      tag: "meta",
      attrs:
        "name" in tag
          ? { name: tag.name, content: tag.content }
          : { property: tag.property, content: tag.content },
    });
  }

  for (const item of toStructuredDataItems(structuredData)) {
    entries.push({
      tag: "script",
      attrs: { type: "application/ld+json" },
      content: safeJsonLdStringify(item),
    });
  }

  return entries;
}
