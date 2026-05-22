import type { BlogPost, BlogPostSummary } from "../blog/blog-types";
import {
  INSTALL_SCRIPT_URL,
  REPOSITORY_URL,
  SELF_HOST_DOCS_URL,
} from "../config/landing-config";

export type StructuredData = Record<string, unknown>;
export type StructuredImageMetadata = {
  height: number;
  url: string;
  width: number;
};

export const ONEQUERY_SITE_NAME = "OneQuery";
export const ONEQUERY_SITE_URL = "https://onequery.dev";
export const ONEQUERY_DEFAULT_DESCRIPTION =
  "OneQuery gives AI agents production context without production keys, using approved sources, centralized credentials, enforced limits, and full audit logs.";

const DEFAULT_IMAGE_WIDTH = 1200;
const DEFAULT_IMAGE_HEIGHT = 630;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const READ_TIME_MINUTES_PATTERN = /\d+/u;
const CORE_TOPICS = [
  "AI agent data access",
  "production data access",
  "centralized credentials",
  "audit logs",
  "read-only query validation",
  "safe production debugging",
] as const;

type SiteInput = string | URL | null | undefined;

type LandingPageStructuredDataInput = {
  description: string;
  imageAlt: string;
  imageHeight?: number;
  imageUrl: string;
  imageWidth?: number;
  site?: SiteInput;
  title: string;
  video?: LandingVideoStructuredDataInput;
};

type LandingVideoStructuredDataInput = {
  contentUrl: string;
  description: string;
  duration?: string;
  embedUrl?: string;
  name: string;
  pageUrl: string;
  thumbnailHeight?: number;
  thumbnailUrl: string;
  thumbnailWidth?: number;
  uploadDate: string;
};

type BlogIndexStructuredDataInput = {
  breadcrumbName?: string;
  description: string;
  itemListName?: string;
  pathname?: string;
  postImages?: Partial<Record<string, StructuredImageMetadata>>;
  posts: readonly BlogPostSummary[];
  site?: SiteInput;
  title: string;
};

export function normalizeSiteUrl(site: SiteInput = ONEQUERY_SITE_URL) {
  const rawSite = site instanceof URL ? site.toString() : site;
  const siteUrl = rawSite && rawSite.length > 0 ? rawSite : ONEQUERY_SITE_URL;

  return siteUrl.replace(/\/+$/u, "");
}

export function toAbsoluteSiteUrl(pathOrUrl: string, site?: SiteInput) {
  if (/^https?:\/\//u.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const siteUrl = normalizeSiteUrl(site);
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;

  return `${siteUrl}${path}`;
}

export function createCanonicalUrl(pathname: string, site?: SiteInput) {
  const siteUrl = normalizeSiteUrl(site);
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const hasFileExtension = /\/[^/]+\.[^/]+$/u.test(path);
  const normalizedPath =
    path === "/" || path.endsWith("/") || hasFileExtension ? path : `${path}/`;

  return `${siteUrl}${normalizedPath}`;
}

export function toIsoDateTime(date: string) {
  if (!ISO_DATE_PATTERN.test(date)) {
    return undefined;
  }

  const parsedDate = new Date(`${date}T00:00:00.000Z`);

  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  const isoDateTime = parsedDate.toISOString();

  return isoDateTime.startsWith(date) ? isoDateTime : undefined;
}

export function getBlogPostKeywords(post: Pick<BlogPost, "category">) {
  return [
    "OneQuery",
    "AI agents",
    "production data access",
    "governed data access",
    "agent safety",
    post.category,
  ].join(", ");
}

function createGraph(graph: StructuredData[]): StructuredData {
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

function getOrganizationId(site: SiteInput) {
  return `${normalizeSiteUrl(site)}/#organization`;
}

function getWebsiteId(site: SiteInput) {
  return `${normalizeSiteUrl(site)}/#website`;
}

function getSoftwareApplicationId(site: SiteInput) {
  return `${normalizeSiteUrl(site)}/#software`;
}

function getLandingDemoVideoId(site: SiteInput) {
  return `${normalizeSiteUrl(site)}/#demo-video`;
}

function createImageObject(input: {
  alt?: string;
  height?: number;
  site?: SiteInput;
  url: string;
  width?: number;
}) {
  return {
    "@type": "ImageObject",
    url: toAbsoluteSiteUrl(input.url, input.site),
    ...(input.alt ? { caption: input.alt } : {}),
    ...(input.width ? { width: input.width } : {}),
    ...(input.height ? { height: input.height } : {}),
  };
}

function createOneQueryOrganization(site: SiteInput): StructuredData {
  const siteUrl = normalizeSiteUrl(site);

  return {
    "@type": "Organization",
    "@id": getOrganizationId(siteUrl),
    name: ONEQUERY_SITE_NAME,
    url: `${siteUrl}/`,
    logo: createImageObject({
      alt: "OneQuery icon",
      height: 512,
      site: siteUrl,
      url: "/onequery-icon.png",
      width: 512,
    }),
    sameAs: [REPOSITORY_URL],
    knowsAbout: [...CORE_TOPICS],
  };
}

function createOneQueryWebsite(site: SiteInput): StructuredData {
  const siteUrl = normalizeSiteUrl(site);

  return {
    "@type": "WebSite",
    "@id": getWebsiteId(siteUrl),
    name: ONEQUERY_SITE_NAME,
    url: `${siteUrl}/`,
    description: ONEQUERY_DEFAULT_DESCRIPTION,
    inLanguage: "en",
    publisher: {
      "@id": getOrganizationId(siteUrl),
    },
  };
}

function createOneQuerySoftwareApplication(input: {
  description: string;
  site?: SiteInput;
}): StructuredData {
  const siteUrl = normalizeSiteUrl(input.site);

  return {
    "@type": "SoftwareApplication",
    "@id": getSoftwareApplicationId(siteUrl),
    name: ONEQUERY_SITE_NAME,
    url: `${siteUrl}/`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, CLI, Self-hosted gateway",
    description: input.description,
    image: createImageObject({
      alt: "OneQuery icon",
      height: 512,
      site: siteUrl,
      url: "/onequery-icon.png",
      width: 512,
    }),
    publisher: {
      "@id": getOrganizationId(siteUrl),
    },
    sameAs: [REPOSITORY_URL],
    codeRepository: REPOSITORY_URL,
    installUrl: INSTALL_SCRIPT_URL,
    softwareHelp: SELF_HOST_DOCS_URL,
    featureList: [
      "Governed production data access for AI agents",
      "Centralized credentials",
      "Read-only query validation",
      "Audit logs for agent data access",
    ],
  };
}

function createLandingDemoVideoStructuredData(
  input: LandingVideoStructuredDataInput & { site?: SiteInput }
): StructuredData {
  const siteUrl = normalizeSiteUrl(input.site);
  const thumbnailUrl = toAbsoluteSiteUrl(input.thumbnailUrl, siteUrl);
  const pageUrl = toAbsoluteSiteUrl(input.pageUrl, siteUrl);

  return {
    "@type": "VideoObject",
    "@id": getLandingDemoVideoId(siteUrl),
    name: input.name,
    description: input.description,
    thumbnailUrl: [thumbnailUrl],
    uploadDate: input.uploadDate,
    ...(input.duration ? { duration: input.duration } : {}),
    contentUrl: toAbsoluteSiteUrl(input.contentUrl, siteUrl),
    ...(input.embedUrl
      ? { embedUrl: toAbsoluteSiteUrl(input.embedUrl, siteUrl) }
      : {}),
    url: pageUrl,
    inLanguage: "en",
    publisher: {
      "@id": getOrganizationId(siteUrl),
    },
    isPartOf: {
      "@id": `${siteUrl}/#webpage`,
    },
    mainEntityOfPage: {
      "@id": `${siteUrl}/#webpage`,
    },
    thumbnail: createImageObject({
      height: input.thumbnailHeight,
      site: siteUrl,
      url: thumbnailUrl,
      width: input.thumbnailWidth,
    }),
  };
}

function createSiteGraph(site: SiteInput): StructuredData[] {
  return [createOneQueryOrganization(site), createOneQueryWebsite(site)];
}

export function createLandingPageStructuredData(
  input: LandingPageStructuredDataInput
): StructuredData {
  const siteUrl = normalizeSiteUrl(input.site);
  const videoReference = input.video
    ? {
        "@id": getLandingDemoVideoId(siteUrl),
      }
    : undefined;

  return createGraph([
    ...createSiteGraph(siteUrl),
    createOneQuerySoftwareApplication({
      description: input.description,
      site: siteUrl,
    }),
    ...(input.video
      ? [
          createLandingDemoVideoStructuredData({
            ...input.video,
            site: siteUrl,
          }),
        ]
      : []),
    {
      "@type": "WebPage",
      "@id": `${siteUrl}/#webpage`,
      url: `${siteUrl}/`,
      name: input.title,
      description: input.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      about: {
        "@id": getSoftwareApplicationId(siteUrl),
      },
      ...(videoReference
        ? {
            hasPart: videoReference,
            video: videoReference,
          }
        : {}),
      primaryImageOfPage: createImageObject({
        alt: input.imageAlt,
        height: input.imageHeight ?? DEFAULT_IMAGE_HEIGHT,
        site: siteUrl,
        url: input.imageUrl,
        width: input.imageWidth ?? DEFAULT_IMAGE_WIDTH,
      }),
      breadcrumb: {
        "@id": `${siteUrl}/#breadcrumb`,
      },
      significantLink: [
        createCanonicalUrl("/blog", siteUrl),
        INSTALL_SCRIPT_URL,
        SELF_HOST_DOCS_URL,
      ],
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${siteUrl}/#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY_SITE_NAME,
          item: `${siteUrl}/`,
        },
      ],
    },
  ]);
}

export function createBlogIndexStructuredData(
  input: BlogIndexStructuredDataInput
): StructuredData {
  const siteUrl = normalizeSiteUrl(input.site);
  const blogUrl = createCanonicalUrl("/blog", siteUrl);
  const pageUrl = createCanonicalUrl(input.pathname ?? "/blog", siteUrl);
  const breadcrumbItems = [
    {
      "@type": "ListItem",
      position: 1,
      name: ONEQUERY_SITE_NAME,
      item: `${siteUrl}/`,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Blog",
      item: blogUrl,
    },
  ];

  if (pageUrl !== blogUrl) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: input.breadcrumbName ?? input.title,
      item: pageUrl,
    });
  }

  return createGraph([
    ...createSiteGraph(siteUrl),
    {
      "@type": "Blog",
      "@id": `${blogUrl}#blog`,
      name: "OneQuery Blog",
      url: blogUrl,
      description: input.description,
      inLanguage: "en",
      publisher: {
        "@id": getOrganizationId(siteUrl),
      },
      blogPost: input.posts.map((post) => ({
        "@id": `${createCanonicalUrl(`/blog/${post.slug}`, siteUrl)}#article`,
      })),
    },
    {
      "@type": "CollectionPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
      name: input.title,
      description: input.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      mainEntity: {
        "@id": `${blogUrl}#blog`,
      },
      breadcrumb: {
        "@id": `${blogUrl}#breadcrumb`,
      },
    },
    {
      "@type": "ItemList",
      "@id": `${pageUrl}#posts`,
      name: input.itemListName ?? "OneQuery Blog posts",
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      numberOfItems: input.posts.length,
      itemListElement: input.posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: createBlogPostSummaryStructuredData(
          post,
          siteUrl,
          input.postImages?.[post.slug]
        ),
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${pageUrl}#breadcrumb`,
      itemListElement: breadcrumbItems,
    },
  ]);
}

export function createBlogPostStructuredData(
  post: BlogPost,
  site?: SiteInput,
  image: StructuredImageMetadata = {
    height: DEFAULT_IMAGE_HEIGHT,
    url: "/og.png",
    width: DEFAULT_IMAGE_WIDTH,
  }
): StructuredData {
  const siteUrl = normalizeSiteUrl(site);
  const blogUrl = createCanonicalUrl("/blog", siteUrl);
  const postUrl = createCanonicalUrl(`/blog/${post.slug}`, siteUrl);
  const publishedTime = toIsoDateTime(post.publishedAt);
  const postSections = post.sections;

  return createGraph([
    ...createSiteGraph(siteUrl),
    {
      "@type": "Blog",
      "@id": `${blogUrl}#blog`,
      name: "OneQuery Blog",
      url: blogUrl,
      publisher: {
        "@id": getOrganizationId(siteUrl),
      },
    },
    {
      "@type": "BlogPosting",
      "@id": `${postUrl}#article`,
      mainEntityOfPage: {
        "@id": `${postUrl}#webpage`,
      },
      headline: post.title,
      description: post.description,
      image: createImageObject({
        alt: `${post.title} - OneQuery Blog`,
        height: image.height,
        site: siteUrl,
        url: image.url,
        width: image.width,
      }),
      ...(publishedTime
        ? {
            datePublished: publishedTime,
            dateModified: publishedTime,
          }
        : {}),
      author: {
        "@id": getOrganizationId(siteUrl),
        name: "OneQuery Maintainers",
      },
      publisher: {
        "@id": getOrganizationId(siteUrl),
      },
      isPartOf: {
        "@id": `${blogUrl}#blog`,
      },
      articleSection: post.category,
      keywords: getBlogPostKeywords(post),
      inLanguage: "en",
      isAccessibleForFree: true,
      timeRequired: readTimeToDuration(post.readTime),
      wordCount: countWords(getPostText(post)),
      about: [...CORE_TOPICS],
      hasPart: postSections.map((section) => ({
        "@type": "WebPageElement",
        "@id": `${postUrl}#${section.id}`,
        name: section.title,
        url: `${postUrl}#${section.id}`,
      })),
    },
    {
      "@type": "WebPage",
      "@id": `${postUrl}#webpage`,
      url: postUrl,
      name: `${post.title} | OneQuery Blog`,
      description: post.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      mainEntity: {
        "@id": `${postUrl}#article`,
      },
      breadcrumb: {
        "@id": `${postUrl}#breadcrumb`,
      },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${postUrl}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY_SITE_NAME,
          item: `${siteUrl}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Blog",
          item: blogUrl,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: post.title,
          item: postUrl,
        },
      ],
    },
  ]);
}

function createBlogPostSummaryStructuredData(
  post: BlogPostSummary,
  site: SiteInput,
  image: StructuredImageMetadata = {
    height: DEFAULT_IMAGE_HEIGHT,
    url: "/og.png",
    width: DEFAULT_IMAGE_WIDTH,
  }
): StructuredData {
  const siteUrl = normalizeSiteUrl(site);
  const postUrl = createCanonicalUrl(`/blog/${post.slug}`, siteUrl);
  const publishedTime = toIsoDateTime(post.publishedAt);

  return {
    "@type": "BlogPosting",
    "@id": `${postUrl}#article`,
    url: postUrl,
    headline: post.title,
    description: post.description,
    image: createImageObject({
      alt: `${post.title} - OneQuery Blog`,
      height: image.height,
      site: siteUrl,
      url: image.url,
      width: image.width,
    }),
    ...(publishedTime ? { datePublished: publishedTime } : {}),
    author: {
      "@id": getOrganizationId(siteUrl),
      name: "OneQuery Maintainers",
    },
    publisher: {
      "@id": getOrganizationId(siteUrl),
    },
    articleSection: post.category,
    keywords: getBlogPostKeywords(post),
    inLanguage: "en",
  };
}

function getPostText(post: BlogPost) {
  const sectionText = post.sections.flatMap((section) => [
    section.title,
    ...section.paragraphs,
    ...(section.table
      ? [...section.table.headers, ...section.table.rows.flatMap((row) => row)]
      : []),
  ]);

  return [post.title, post.description, ...sectionText].join(" ");
}

function countWords(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function readTimeToDuration(readTime: string) {
  const match = READ_TIME_MINUTES_PATTERN.exec(readTime);

  if (!match) {
    return undefined;
  }

  return `PT${match[0]}M`;
}
