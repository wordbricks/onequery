import type { JsonLdObject, StructuredDataGraph } from "@onequery/astro-seo";

import type { BlogPost, BlogPostSummary } from "@/features/blog/types";
import type { ComparisonPage } from "@/features/compare/types";
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

import {
  ONEQUERY,
  SCHEMA_FRAGMENTS,
  SCHEMA_URLS,
  SEO_PATHS,
} from "./constants";
import type { SeoImage } from "./constants";

type StructuredDataNode = JsonLdObject;

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

export type SiteInput = string | URL | null | undefined;

type HomePageStructuredDataInput = {
  description: string;
  image: SeoImage & { alt: string };
  site?: SiteInput;
  title: string;
  video?: DemoVideoStructuredDataInput;
};

type DemoVideoStructuredDataInput = {
  contentUrl: string;
  description: string;
  duration: string;
  name: string;
  pageUrl: string;
  thumbnail: SeoImage;
  uploadDate: string;
};

type BlogIndexStructuredDataInput = {
  breadcrumbName: string;
  description: string;
  itemListName: string;
  pathname: string;
  postImages: Readonly<Record<string, SeoImage>>;
  posts: readonly BlogPostSummary[];
  site?: SiteInput;
  title: string;
};

type BlogPostStructuredDataInput = {
  image: SeoImage;
  post: BlogPost;
  site?: SiteInput;
};

type BreadcrumbListItem = {
  "@type": "ListItem";
  item: string;
  name: string;
  position: number;
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

type ComparisonIndexStructuredDataInput = {
  comparisons: readonly ComparisonPage[];
  description: string;
  site?: SiteInput;
  title: string;
};

type ComparisonPageStructuredDataInput = {
  comparison: ComparisonPage;
  relatedComparisons: readonly ComparisonPage[];
  site?: SiteInput;
};

type DocsIndexStructuredDataInput = {
  description: string;
  site?: SiteInput;
  title: string;
};

export function normalizeSiteUrl(site: SiteInput = ONEQUERY.SITE_URL) {
  const rawSite = site instanceof URL ? site.toString() : site;
  const siteUrl = rawSite && rawSite.length > 0 ? rawSite : ONEQUERY.SITE_URL;

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
    ONEQUERY.NAME,
    "AI agents",
    "production data access",
    "governed data access",
    "agent safety",
    post.category,
  ].join(", ");
}

function createGraph(graph: StructuredDataNode[]): StructuredDataGraph {
  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

function getNodeId(baseUrl: string, fragment: string) {
  return `${baseUrl}#${fragment}`;
}

function getOrganizationId(site: SiteInput) {
  return getNodeId(`${normalizeSiteUrl(site)}/`, SCHEMA_FRAGMENTS.ORGANIZATION);
}

function getWebsiteId(site: SiteInput) {
  return getNodeId(`${normalizeSiteUrl(site)}/`, SCHEMA_FRAGMENTS.WEBSITE);
}

function getSoftwareApplicationId(site: SiteInput) {
  return getNodeId(`${normalizeSiteUrl(site)}/`, SCHEMA_FRAGMENTS.SOFTWARE);
}

function getDemoVideoId(site: SiteInput) {
  return getNodeId(`${normalizeSiteUrl(site)}/`, SCHEMA_FRAGMENTS.DEMO_VIDEO);
}

function getBlogPostId(postUrl: string) {
  return getNodeId(postUrl, SCHEMA_FRAGMENTS.ARTICLE);
}

function getBlogPostUrl(slug: string, site: SiteInput) {
  return createCanonicalUrl(`${SEO_PATHS.BLOG}/${slug}`, site);
}

function getBlogPostImage(
  imagesBySlug: Readonly<Record<string, SeoImage>>,
  slug: string
) {
  const image = imagesBySlug[slug];

  if (!image) {
    throw new Error(`Missing structured data image for blog post "${slug}".`);
  }

  return image;
}

function createImageObject(input: {
  alt?: string;
  height: number;
  site: SiteInput;
  url: string;
  width: number;
}): StructuredDataNode {
  return {
    "@type": "ImageObject",
    url: toAbsoluteSiteUrl(input.url, input.site),
    ...(input.alt ? { caption: input.alt } : {}),
    width: input.width,
    height: input.height,
  };
}

function createOneQueryOrganization(site: SiteInput): StructuredDataNode {
  const siteUrl = normalizeSiteUrl(site);

  return {
    "@type": "Organization",
    "@id": getOrganizationId(siteUrl),
    name: ONEQUERY.NAME,
    url: `${siteUrl}/`,
    logo: createImageObject({
      ...ONEQUERY.IMAGES.ICON,
      alt: ONEQUERY.ICON_IMAGE_ALT,
      site: siteUrl,
    }),
    sameAs: [REPOSITORY_URL],
    knowsAbout: [...CORE_TOPICS],
  };
}

function createOneQueryWebsite(site: SiteInput): StructuredDataNode {
  const siteUrl = normalizeSiteUrl(site);

  return {
    "@type": "WebSite",
    "@id": getWebsiteId(siteUrl),
    name: ONEQUERY.NAME,
    url: `${siteUrl}/`,
    description: ONEQUERY.SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: {
      "@id": getOrganizationId(siteUrl),
    },
  };
}

function createOneQuerySoftwareApplication(input: {
  description: string;
  site: SiteInput;
}): StructuredDataNode {
  const siteUrl = normalizeSiteUrl(input.site);

  return {
    "@type": "SoftwareApplication",
    "@id": getSoftwareApplicationId(siteUrl),
    name: ONEQUERY.NAME,
    url: `${siteUrl}/`,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, CLI, Self-hosted gateway",
    description: input.description,
    image: createImageObject({
      ...ONEQUERY.IMAGES.ICON,
      alt: ONEQUERY.ICON_IMAGE_ALT,
      site: siteUrl,
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
  input: DemoVideoStructuredDataInput & { site: SiteInput }
): StructuredDataNode {
  const siteUrl = normalizeSiteUrl(input.site);
  const thumbnailUrl = toAbsoluteSiteUrl(input.thumbnail.url, siteUrl);
  const pageUrl = toAbsoluteSiteUrl(input.pageUrl, siteUrl);

  return {
    "@type": "VideoObject",
    "@id": getDemoVideoId(siteUrl),
    name: input.name,
    description: input.description,
    thumbnailUrl: [thumbnailUrl],
    uploadDate: input.uploadDate,
    duration: input.duration,
    contentUrl: toAbsoluteSiteUrl(input.contentUrl, siteUrl),
    url: pageUrl,
    inLanguage: "en",
    publisher: {
      "@id": getOrganizationId(siteUrl),
    },
    isPartOf: {
      "@id": getNodeId(`${siteUrl}/`, SCHEMA_FRAGMENTS.WEBPAGE),
    },
    mainEntityOfPage: {
      "@id": getNodeId(`${siteUrl}/`, SCHEMA_FRAGMENTS.WEBPAGE),
    },
    thumbnail: createImageObject({
      height: input.thumbnail.height,
      site: siteUrl,
      url: thumbnailUrl,
      width: input.thumbnail.width,
    }),
  };
}

function createSiteGraph(site: SiteInput): StructuredDataNode[] {
  return [createOneQueryOrganization(site), createOneQueryWebsite(site)];
}

function createConnectorFeatureList(connector: DataSourceConnector) {
  return [
    `${connector.label} ${getConnectorInterfaceDescription(connector)}`,
    `${connector.availability} setup for approved source access`,
    "Centralized credentials for AI agent workflows",
    `Audit-ready source access through ${ONEQUERY.NAME}`,
  ];
}

function getComparisonPagePath(comparison: Pick<ComparisonPage, "slug">) {
  return `${SEO_PATHS.COMPARE}/${comparison.slug}`;
}

function createComparisonSummaryStructuredData(
  comparison: ComparisonPage,
  site: SiteInput
): StructuredDataNode {
  const pageUrl = createCanonicalUrl(getComparisonPagePath(comparison), site);

  return {
    "@type": "WebPage",
    "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.WEBPAGE),
    url: pageUrl,
    name: comparison.title,
    headline: comparison.title,
    description: comparison.metaDescription,
    inLanguage: "en",
    about: {
      "@id": getSoftwareApplicationId(site),
    },
  };
}

function createConnectorSoftwareApplication(
  connector: DataSourceConnector,
  site: SiteInput
): StructuredDataNode {
  const siteUrl = normalizeSiteUrl(site);
  const connectorUrl = createCanonicalUrl(getConnectorPath(connector), siteUrl);
  const connectorId = getNodeId(connectorUrl, SCHEMA_FRAGMENTS.CONNECTOR);

  return {
    "@type": "SoftwareApplication",
    "@id": connectorId,
    name: `${ONEQUERY.NAME} ${connector.label} connector`,
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
): StructuredDataGraph {
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
      "@id": getNodeId(`${siteUrl}/`, SCHEMA_FRAGMENTS.WEBPAGE),
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
        alt: input.image.alt,
        height: input.image.height,
        site: siteUrl,
        url: input.image.url,
        width: input.image.width,
      }),
      breadcrumb: {
        "@id": getNodeId(`${siteUrl}/`, SCHEMA_FRAGMENTS.BREADCRUMB),
      },
      significantLink: [
        createCanonicalUrl(SEO_PATHS.BLOG, siteUrl),
        NPM_PACKAGE_URL,
        SELF_HOST_DOCS_URL,
      ],
    },
    {
      "@type": "BreadcrumbList",
      "@id": getNodeId(`${siteUrl}/`, SCHEMA_FRAGMENTS.BREADCRUMB),
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY.NAME,
          item: `${siteUrl}/`,
        },
      ],
    },
  ]);
}

export function createDocsIndexStructuredData(
  input: DocsIndexStructuredDataInput
): StructuredDataGraph {
  const siteUrl = normalizeSiteUrl(input.site);
  const docsUrl = createCanonicalUrl(SEO_PATHS.DOCS, siteUrl);

  return createGraph([
    ...createSiteGraph(siteUrl),
    createOneQuerySoftwareApplication({
      description: ONEQUERY.SITE_DESCRIPTION,
      site: siteUrl,
    }),
    {
      "@type": "WebPage",
      "@id": getNodeId(docsUrl, SCHEMA_FRAGMENTS.WEBPAGE),
      url: docsUrl,
      name: input.title,
      headline: input.title,
      description: input.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      about: {
        "@id": getSoftwareApplicationId(siteUrl),
      },
      breadcrumb: {
        "@id": getNodeId(docsUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      },
    },
    {
      "@type": "BreadcrumbList",
      "@id": getNodeId(docsUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY.NAME,
          item: `${siteUrl}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Documentation",
          item: docsUrl,
        },
      ],
    },
  ]);
}

export function createComparisonIndexStructuredData(
  input: ComparisonIndexStructuredDataInput
): StructuredDataGraph {
  const siteUrl = normalizeSiteUrl(input.site);
  const compareUrl = createCanonicalUrl(SEO_PATHS.COMPARE, siteUrl);

  return createGraph([
    ...createSiteGraph(siteUrl),
    createOneQuerySoftwareApplication({
      description: ONEQUERY.SITE_DESCRIPTION,
      site: siteUrl,
    }),
    {
      "@type": "CollectionPage",
      "@id": getNodeId(compareUrl, SCHEMA_FRAGMENTS.WEBPAGE),
      url: compareUrl,
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
        "@id": getNodeId(compareUrl, SCHEMA_FRAGMENTS.COMPARISONS),
      },
      breadcrumb: {
        "@id": getNodeId(compareUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      },
    },
    {
      "@type": "ItemList",
      "@id": getNodeId(compareUrl, SCHEMA_FRAGMENTS.COMPARISONS),
      name: `${ONEQUERY.NAME} AI agent data access comparisons`,
      numberOfItems: input.comparisons.length,
      itemListElement: input.comparisons.map((comparison, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: createComparisonSummaryStructuredData(comparison, siteUrl),
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": getNodeId(compareUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY.NAME,
          item: `${siteUrl}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Compare",
          item: compareUrl,
        },
      ],
    },
  ]);
}

export function createComparisonPageStructuredData(
  input: ComparisonPageStructuredDataInput
): StructuredDataGraph {
  const siteUrl = normalizeSiteUrl(input.site);
  const compareUrl = createCanonicalUrl(SEO_PATHS.COMPARE, siteUrl);
  const pageUrl = createCanonicalUrl(
    getComparisonPagePath(input.comparison),
    siteUrl
  );

  return createGraph([
    ...createSiteGraph(siteUrl),
    createOneQuerySoftwareApplication({
      description: ONEQUERY.SITE_DESCRIPTION,
      site: siteUrl,
    }),
    {
      "@type": "WebPage",
      "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.WEBPAGE),
      url: pageUrl,
      name: input.comparison.title,
      headline: input.comparison.title,
      description: input.comparison.metaDescription,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      about: {
        "@id": getSoftwareApplicationId(siteUrl),
      },
      mainEntity: {
        "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.COMPARISON_CRITERIA),
      },
      hasPart: [
        {
          "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.COMPARISON_CRITERIA),
        },
        {
          "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.FAQ),
        },
      ],
      relatedLink: input.relatedComparisons.map((comparison) =>
        createCanonicalUrl(getComparisonPagePath(comparison), siteUrl)
      ),
      breadcrumb: {
        "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      },
    },
    {
      "@type": "ItemList",
      "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.COMPARISON_CRITERIA),
      name: `${ONEQUERY.NAME} vs ${input.comparison.alternativeName} comparison criteria`,
      numberOfItems: input.comparison.criteria.length,
      itemListElement: input.comparison.criteria.map((criterion, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: criterion.factor,
        description: `${criterion.oneQuery} Alternative: ${criterion.alternative}`,
      })),
    },
    {
      "@type": "FAQPage",
      "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.FAQ),
      mainEntity: input.comparison.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY.NAME,
          item: `${siteUrl}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Compare",
          item: compareUrl,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: input.comparison.alternativeName,
          item: pageUrl,
        },
      ],
    },
  ]);
}

export function createBlogIndexStructuredData(
  input: BlogIndexStructuredDataInput
): StructuredDataGraph {
  const siteUrl = normalizeSiteUrl(input.site);
  const blogUrl = createCanonicalUrl(SEO_PATHS.BLOG, siteUrl);
  const pageUrl = createCanonicalUrl(input.pathname, siteUrl);
  const breadcrumbItems: BreadcrumbListItem[] = [
    {
      "@type": "ListItem",
      position: 1,
      name: ONEQUERY.NAME,
      item: `${siteUrl}/`,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: ONEQUERY.BLOG_NAME,
      item: blogUrl,
    },
  ];

  if (pageUrl !== blogUrl) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: input.breadcrumbName,
      item: pageUrl,
    });
  }

  return createGraph([
    ...createSiteGraph(siteUrl),
    {
      "@type": "Blog",
      "@id": getNodeId(blogUrl, SCHEMA_FRAGMENTS.BLOG),
      name: ONEQUERY.BLOG_NAME,
      url: blogUrl,
      description: input.description,
      inLanguage: "en",
      publisher: {
        "@id": getOrganizationId(siteUrl),
      },
      blogPost: input.posts.map((post) => ({
        "@id": getBlogPostId(getBlogPostUrl(post.slug, siteUrl)),
      })),
    },
    {
      "@type": "CollectionPage",
      "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.WEBPAGE),
      url: pageUrl,
      name: input.title,
      description: input.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      mainEntity: {
        "@id": getNodeId(blogUrl, SCHEMA_FRAGMENTS.BLOG),
      },
      breadcrumb: {
        "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      },
    },
    {
      "@type": "ItemList",
      "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.POSTS),
      name: input.itemListName,
      itemListOrder: SCHEMA_URLS.DESCENDING_ITEM_LIST_ORDER,
      numberOfItems: input.posts.length,
      itemListElement: input.posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: createBlogPostSummaryStructuredData(
          post,
          siteUrl,
          getBlogPostImage(input.postImages, post.slug)
        ),
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": getNodeId(pageUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      itemListElement: breadcrumbItems,
    },
  ]);
}

export function createConnectorIndexStructuredData(
  input: ConnectorIndexStructuredDataInput
): StructuredDataGraph {
  const siteUrl = normalizeSiteUrl(input.site);
  const connectorsUrl = createCanonicalUrl(SEO_PATHS.CONNECTORS, siteUrl);

  return createGraph([
    ...createSiteGraph(siteUrl),
    createOneQuerySoftwareApplication({
      description: ONEQUERY.SITE_DESCRIPTION,
      site: siteUrl,
    }),
    {
      "@type": "CollectionPage",
      "@id": getNodeId(connectorsUrl, SCHEMA_FRAGMENTS.WEBPAGE),
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
        "@id": getNodeId(connectorsUrl, SCHEMA_FRAGMENTS.CONNECTORS),
      },
      breadcrumb: {
        "@id": getNodeId(connectorsUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      },
    },
    {
      "@type": "ItemList",
      "@id": getNodeId(connectorsUrl, SCHEMA_FRAGMENTS.CONNECTORS),
      name: `${ONEQUERY.NAME} supported data source connectors`,
      numberOfItems: input.connectors.length,
      itemListElement: input.connectors.map((connector, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: createConnectorSoftwareApplication(connector, siteUrl),
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": getNodeId(connectorsUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY.NAME,
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
): StructuredDataGraph {
  const siteUrl = normalizeSiteUrl(input.site);
  const connectorsUrl = createCanonicalUrl(SEO_PATHS.CONNECTORS, siteUrl);
  const connectorUrl = createCanonicalUrl(
    getConnectorPath(input.connector),
    siteUrl
  );
  const connectorId = getNodeId(connectorUrl, SCHEMA_FRAGMENTS.CONNECTOR);

  return createGraph([
    ...createSiteGraph(siteUrl),
    createOneQuerySoftwareApplication({
      description: ONEQUERY.SITE_DESCRIPTION,
      site: siteUrl,
    }),
    createConnectorSoftwareApplication(input.connector, siteUrl),
    {
      "@type": "WebPage",
      "@id": getNodeId(connectorUrl, SCHEMA_FRAGMENTS.WEBPAGE),
      url: connectorUrl,
      name: input.title,
      description: input.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      about: {
        "@id": connectorId,
      },
      mainEntity: {
        "@id": connectorId,
      },
      hasPart: [
        {
          "@id": getNodeId(connectorUrl, SCHEMA_FRAGMENTS.FAQ),
        },
        {
          "@id": getNodeId(connectorUrl, SCHEMA_FRAGMENTS.SETUP_CHECKLIST),
        },
      ],
      relatedLink: input.relatedConnectors.map((connector) =>
        createCanonicalUrl(getConnectorPath(connector), siteUrl)
      ),
      breadcrumb: {
        "@id": getNodeId(connectorUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      },
    },
    {
      "@type": "FAQPage",
      "@id": getNodeId(connectorUrl, SCHEMA_FRAGMENTS.FAQ),
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
      "@id": getNodeId(connectorUrl, SCHEMA_FRAGMENTS.SETUP_CHECKLIST),
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
      "@id": getNodeId(connectorUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY.NAME,
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
  input: BlogPostStructuredDataInput
): StructuredDataGraph {
  const { image, post } = input;
  const siteUrl = normalizeSiteUrl(input.site);
  const blogUrl = createCanonicalUrl(SEO_PATHS.BLOG, siteUrl);
  const postUrl = getBlogPostUrl(post.slug, siteUrl);
  const publishedTime = toIsoDateTime(post.publishedAt);
  const postSections = post.headings.filter((heading) => heading.depth === 2);

  return createGraph([
    ...createSiteGraph(siteUrl),
    {
      "@type": "Blog",
      "@id": getNodeId(blogUrl, SCHEMA_FRAGMENTS.BLOG),
      name: ONEQUERY.BLOG_NAME,
      url: blogUrl,
      publisher: {
        "@id": getOrganizationId(siteUrl),
      },
    },
    {
      "@type": "BlogPosting",
      "@id": getBlogPostId(postUrl),
      mainEntityOfPage: {
        "@id": getNodeId(postUrl, SCHEMA_FRAGMENTS.WEBPAGE),
      },
      headline: post.title,
      description: post.description,
      image: createImageObject({
        alt: `${post.title} - ${ONEQUERY.BLOG_NAME}`,
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
        name: ONEQUERY.AUTHOR_NAME,
      },
      publisher: {
        "@id": getOrganizationId(siteUrl),
      },
      isPartOf: {
        "@id": getNodeId(blogUrl, SCHEMA_FRAGMENTS.BLOG),
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
      "@id": getNodeId(postUrl, SCHEMA_FRAGMENTS.WEBPAGE),
      url: postUrl,
      name: `${post.title} | ${ONEQUERY.BLOG_NAME}`,
      description: post.description,
      inLanguage: "en",
      isPartOf: {
        "@id": getWebsiteId(siteUrl),
      },
      mainEntity: {
        "@id": getBlogPostId(postUrl),
      },
      breadcrumb: {
        "@id": getNodeId(postUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      },
    },
    {
      "@type": "BreadcrumbList",
      "@id": getNodeId(postUrl, SCHEMA_FRAGMENTS.BREADCRUMB),
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: ONEQUERY.NAME,
          item: `${siteUrl}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: ONEQUERY.BLOG_NAME,
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
  image: SeoImage
): StructuredDataNode {
  const siteUrl = normalizeSiteUrl(site);
  const postUrl = getBlogPostUrl(post.slug, siteUrl);
  const publishedTime = toIsoDateTime(post.publishedAt);

  return {
    "@type": "BlogPosting",
    "@id": getBlogPostId(postUrl),
    url: postUrl,
    headline: post.title,
    description: post.description,
    image: createImageObject({
      alt: `${post.title} - ${ONEQUERY.BLOG_NAME}`,
      height: image.height,
      site: siteUrl,
      url: image.url,
      width: image.width,
    }),
    ...(publishedTime ? { datePublished: publishedTime } : {}),
    author: {
      "@id": getOrganizationId(siteUrl),
      name: ONEQUERY.AUTHOR_NAME,
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
