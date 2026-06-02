export type SeoImage = {
  height: number;
  url: string;
  width: number;
};

export type ShareImage = SeoImage & {
  type: string;
};

type OneQueryConstants = {
  AUTHOR_NAME: string;
  BLOG_NAME: string;
  BLOG_POSTS_ITEM_LIST_NAME: string;
  DEFAULT_KEYWORDS: string;
  DEFAULT_PAGE_TITLE: string;
  ICON_IMAGE_ALT: string;
  IMAGES: {
    ICON: SeoImage;
    SHARE: ShareImage;
  };
  NAME: string;
  SHARE_IMAGE_ALT: string;
  SITE_DESCRIPTION: string;
  SITE_URL: string;
};

export const ONEQUERY = {
  AUTHOR_NAME: "OneQuery Maintainers",
  BLOG_NAME: "OneQuery Blog",
  BLOG_POSTS_ITEM_LIST_NAME: "OneQuery Blog posts",
  DEFAULT_KEYWORDS:
    "OneQuery, AI agent access control, production context, production keys, Claude Code, centralized credentials, audit logs, capability grants, safe production access",
  DEFAULT_PAGE_TITLE: "OneQuery | Governed Data Access for AI Agents",
  ICON_IMAGE_ALT: "OneQuery icon",
  IMAGES: {
    ICON: {
      height: 512,
      url: "/onequery-icon.png",
      width: 512,
    },
    SHARE: {
      height: 630,
      type: "image/png",
      url: "/og.png",
      width: 1200,
    },
  },
  NAME: "OneQuery",
  SHARE_IMAGE_ALT: "OneQuery - Governed Data Access for AI Agents",
  SITE_DESCRIPTION:
    "OneQuery gives AI agents production context without production keys, using approved sources, centralized credentials, enforced limits, and full audit logs.",
  SITE_URL: "https://onequery.dev",
} as const satisfies OneQueryConstants;

export const SEO_PATHS = {
  BLOG: "/blog",
  CONNECTORS: "/connectors",
  DOCS: "/docs",
} as const;

export const SCHEMA_FRAGMENTS = {
  ARTICLE: "article",
  BLOG: "blog",
  BREADCRUMB: "breadcrumb",
  CONNECTOR: "connector",
  CONNECTORS: "connectors",
  DEMO_VIDEO: "demo-video",
  FAQ: "faq",
  ORGANIZATION: "organization",
  POSTS: "posts",
  SETUP_CHECKLIST: "setup-checklist",
  SOFTWARE: "software",
  WEBPAGE: "webpage",
  WEBSITE: "website",
} as const;

export const SCHEMA_URLS = {
  DESCENDING_ITEM_LIST_ORDER: "https://schema.org/ItemListOrderDescending",
} as const;
