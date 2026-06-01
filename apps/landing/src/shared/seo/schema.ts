import type { BlogPost, BlogPostSummary } from "@/features/blog/types";
import type {
  ConnectorFaq,
  DataSourceConnector,
} from "@/features/connectors/data";
import {
  getConnectorInterfaceDescription,
  getConnectorPath,
} from "@/features/connectors/data";
import {
  NPM_PACKAGE_URL,
  REPOSITORY_URL,
  SELF_HOST_DOCS_URL,
} from "@/shared/config/site";

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

type HomePageStructuredDataInput = {
  description: string;
  imageAlt: string;
  imageHeight?: number;
  imageUrl: string;
  imageWidth?: number;
  site?: SiteInput;
  title: string;
  video?: DemoVideoStructuredDataInput;
};

type DemoVideoStructuredDataInput = {
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

type ConnectorIndexStructuredDataInput = {
  connectors: readonly DataSourceConnector[];
  description: string;
  site?: SiteInput;
  title: string;
};

type ConnectorPageStructuredDataInput = {
  connector: DataSourceConnector;
  description: string;
  faqs: readonly ConnectorFaq[];
  relatedConnectors: readonly DataSourceConnector[];
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

function getDemoVideoId(site: SiteInput) {
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
    installUrl: NPM_PACKAGE_URL,
    softwareHelp: SELF_HOST_DOCS_URL,
    featureList: [
      "Governed production data access for AI agents",
      "Centralized credentials",
      "Read-only query validation",
      "Audit logs for agent data access",
    ],
  };
}

function createDemoVideoStructuredData(
  input: DemoVideoStructuredDataInput & { site?: SiteInput }
): StructuredData {
  const siteUrl = normalizeSiteUrl(input.site);
  const thumbnailUrl = toAbsoluteSiteUrl(input.thumbnailUrl, siteUrl);
  const pageUrl = toAbsoluteSiteUrl(input.pageUrl, siteUrl);

  return {
    "@type": "VideoObject",
    "@id": getDemoVideoId(siteUrl),
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

function createConnectorFeatureList(connector: DataSourceConnector) {
  return [
    `${connector.label} ${getConnectorInterfaceDescription(connector)}`,
    `${connector.availability} setup for approved source access`,
    "Centralized credentials for AI agent workflows",
    "Audit-ready source access through OneQuery",
  ];
}

function createConnectorSoftwareApplication(
  connector: DataSourceConnector,
  site: SiteInput
): StructuredData {
  const siteUrl = normalizeSiteUrl(site);
  const connectorUrl = createCanonicalUrl(getConnectorPath(connector), siteUrl);

  return {
    "@type": "SoftwareApplication",
    "@id": `${connectorUrl}#connector`,
    name: `OneQuery ${connector.label} connector`,
    url: connectorUrl,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: connector.category,
    operatingSystem:
      connector.availability === "Dashboard + CLI"
        ? "Web, CLI, Self-hosted gateway"
        : "CLI, Self-hosted gateway",
    description: connector.description,
    featureList: createConnectorFeatureList(connector),
    publisher: {
      "@id": getOrganizationId(siteUrl),
    },
    isPartOf: {
      "@id": getSoftwareApplicationId(siteUrl),
    },
  };
}

export function createHomePageStructuredData(
  input: HomePageStructuredDataInput
): StructuredData {
  const siteUrl = normalizeSiteUrl(input.site);
  const videoReference = input.video
    ? {
        "@id": getDemoVideoId(siteUrl),
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
          createDemoVideoStructuredData({
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
        NPM_PACKAGE_URL,
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

export function createConnectorIndexStructuredData(
  input: ConnectorIndexStructuredDataInput
): StructuredData {
  const siteUrl = normalizeSiteUrl(input.site);
  const connectorsUrl = createCanonicalUrl("/connectors", siteUrl);

  return createGraph([
    ...createSiteGraph(siteUrl),
    createOneQuerySoftwareApplication({
      description: ONEQUERY_DEFAULT_DESCRIPTION,
      site: siteUrl,
    }),
    {
      "@type": "CollectionPage",
      "@id": `${connectorsUrl}#webpage`,
      url: connectorsUrl,
      name: input.title,
      description: input.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      about: {
        "@id": getSoftwareApplicationId(siteUrl),
      },
      mainEntity: {
        "@id": `${connectorsUrl}#connectors`,
      },
      breadcrumb: {
        "@id": `${connectorsUrl}#breadcrumb`,
      },
    },
    {
      "@type": "ItemList",
      "@id": `${connectorsUrl}#connectors`,
      name: "OneQuery supported data source connectors",
      numberOfItems: input.connectors.length,
      itemListElement: input.connectors.map((connector, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: createConnectorSoftwareApplication(connector, siteUrl),
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${connectorsUrl}#breadcrumb`,
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
          name: "Connectors",
          item: connectorsUrl,
        },
      ],
    },
  ]);
}

export function createConnectorPageStructuredData(
  input: ConnectorPageStructuredDataInput
): StructuredData {
  const siteUrl = normalizeSiteUrl(input.site);
  const connectorsUrl = createCanonicalUrl("/connectors", siteUrl);
  const connectorUrl = createCanonicalUrl(
    getConnectorPath(input.connector),
    siteUrl
  );

  return createGraph([
    ...createSiteGraph(siteUrl),
    createOneQuerySoftwareApplication({
      description: ONEQUERY_DEFAULT_DESCRIPTION,
      site: siteUrl,
    }),
    createConnectorSoftwareApplication(input.connector, siteUrl),
    {
      "@type": "WebPage",
      "@id": `${connectorUrl}#webpage`,
      url: connectorUrl,
      name: input.title,
      description: input.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      about: {
        "@id": `${connectorUrl}#connector`,
      },
      mainEntity: {
        "@id": `${connectorUrl}#connector`,
      },
      hasPart: [
        {
          "@id": `${connectorUrl}#faq`,
        },
        {
          "@id": `${connectorUrl}#setup-checklist`,
        },
      ],
      relatedLink: input.relatedConnectors.map((connector) =>
        createCanonicalUrl(getConnectorPath(connector), siteUrl)
      ),
      breadcrumb: {
        "@id": `${connectorUrl}#breadcrumb`,
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${connectorUrl}#faq`,
      mainEntity: input.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
    {
      "@type": "ItemList",
      "@id": `${connectorUrl}#setup-checklist`,
      name: `${input.connector.label} connector setup checklist`,
      numberOfItems: input.connector.guideSteps.length,
      itemListElement: input.connector.guideSteps.map((step, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: step,
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${connectorUrl}#breadcrumb`,
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
          name: "Connectors",
          item: connectorsUrl,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: input.connector.label,
          item: connectorUrl,
        },
      ],
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
  const postSections = post.headings.filter((heading) => heading.depth === 2);

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
      hasPart: postSections.map((heading) => ({
        "@type": "WebPageElement",
        "@id": `${postUrl}#${heading.slug}`,
        name: heading.text,
        url: `${postUrl}#${heading.slug}`,
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
  return [post.title, post.description, post.body].join(" ");
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
