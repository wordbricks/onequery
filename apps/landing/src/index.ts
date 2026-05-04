import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { getBlogPostSummaryBySlug } from "./landing/blog/blog-posts";
import {
  getBlogPostShareMetadata,
  renderBlogPostShareTags,
} from "./landing/blog/blog-share-metadata";
import { LANDING_API_PREFIX } from "./landing/config/landing-api";
import { landingApp } from "./server/app";
import type { LandingWorkerBindings } from "./server/app";

type LandingWorkerEnv = CloudflareEnv & LandingWorkerBindings;
type LandingAppEnv = {
  Bindings: LandingWorkerEnv;
};

const API_CATALOG_PATH = "/.well-known/api-catalog";
const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';
const ONEQUERY_REPOSITORY_URL = "https://github.com/wordbricks/onequery";
const ONEQUERY_README_URL = `${ONEQUERY_REPOSITORY_URL}/blob/main/README.md`;
const ONEQUERY_DOCS_URL = `${ONEQUERY_README_URL}#documentation`;
const ONEQUERY_PROTO_README_URL = `${ONEQUERY_REPOSITORY_URL}/blob/main/proto/README.md`;
const ONEQUERY_CLI_PROTO_URL =
  "https://raw.githubusercontent.com/wordbricks/onequery/main/proto/onequery/cli/v1/cli.proto";
const AGENT_DISCOVERY_LINK_HEADER = [
  `<${API_CATALOG_PATH}>; rel="api-catalog"; type="application/linkset+json"`,
  `<${ONEQUERY_CLI_PROTO_URL}>; rel="service-desc"; type="text/plain"`,
  `<${ONEQUERY_DOCS_URL}>; rel="service-doc"; type="text/html"`,
  `<${ONEQUERY_README_URL}>; rel="describedby"; type="text/html"`,
].join(", ");
const SHARE_TAG_ATTRIBUTES = [
  "description",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
  "og:type",
  "og:url",
  "og:site_name",
  "og:title",
  "og:description",
  "og:image",
  "og:image:secure_url",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "article:published_time",
];

const agentDiscoveryLinkHeaders = createMiddleware<LandingAppEnv>(
  async (c, next) => {
    await next();
    c.header("Link", AGENT_DISCOVERY_LINK_HEADER, { append: true });
  }
);

function buildApiCatalogLinkset(origin: string) {
  const homepageUrl = `${origin}/`;
  const catalogUrl = `${origin}${API_CATALOG_PATH}`;
  const productUpdatesApiUrl = `${origin}${LANDING_API_PREFIX}/product-updates`;
  const contactApiUrl = `${origin}${LANDING_API_PREFIX}/contact`;

  return {
    linkset: [
      {
        anchor: homepageUrl,
        "api-catalog": [
          {
            href: catalogUrl,
            type: "application/linkset+json",
          },
        ],
        describedby: [
          {
            href: ONEQUERY_README_URL,
            title: "OneQuery README",
            type: "text/html",
          },
        ],
        "service-desc": [
          {
            href: ONEQUERY_CLI_PROTO_URL,
            title: "OneQuery CLI Connect RPC protobuf schema",
            type: "text/plain",
          },
        ],
        "service-doc": [
          {
            href: ONEQUERY_DOCS_URL,
            title: "OneQuery documentation",
            type: "text/html",
          },
        ],
      },
      {
        anchor: catalogUrl,
        item: [
          {
            href: productUpdatesApiUrl,
            title: "Landing product updates API",
          },
          {
            href: contactApiUrl,
            title: "Landing contact API",
          },
        ],
      },
      {
        anchor: ONEQUERY_CLI_PROTO_URL,
        describedby: [
          {
            href: ONEQUERY_PROTO_README_URL,
            title: "OneQuery protobuf workspace documentation",
            type: "text/html",
          },
        ],
      },
    ],
  };
}

function removeExistingShareTag(html: string, attributeValue: string) {
  const tagPattern = new RegExp(
    `<meta\\s+[^>]*(?:name|property)=["']${attributeValue}["'][^>]*>\\s*`,
    "giu"
  );

  return html.replace(tagPattern, "");
}

function injectBlogPostShareTags(html: string, slug: string) {
  const post = getBlogPostSummaryBySlug(slug);

  if (!post) {
    return html;
  }

  const metadata = getBlogPostShareMetadata(post);
  const shareTags = renderBlogPostShareTags(metadata);
  const htmlWithoutStaticShareTags = SHARE_TAG_ATTRIBUTES.reduce(
    removeExistingShareTag,
    html
  )
    .replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>\s*/iu, "")
    .replace(/<title>[\s\S]*?<\/title>\s*/iu, "");

  return htmlWithoutStaticShareTags.replace(
    "</head>",
    `    ${shareTags}\n  </head>`
  );
}

const app = new Hono<LandingAppEnv>()
  .on(["GET", "HEAD"], API_CATALOG_PATH, (c) => {
    c.header("content-type", API_CATALOG_CONTENT_TYPE);
    c.header("Link", AGENT_DISCOVERY_LINK_HEADER);

    if (c.req.method === "HEAD") {
      return c.body(null);
    }

    return c.body(
      `${JSON.stringify(buildApiCatalogLinkset(new URL(c.req.url).origin), null, 2)}\n`
    );
  })
  .route("/", landingApp)
  .on(["GET", "HEAD"], ["/", "/index.html"], agentDiscoveryLinkHeaders, (c) =>
    c.env.ASSETS.fetch(c.req.raw)
  )
  .on("GET", ["/blog/:postSlug", "/blog/:postSlug/"], (c) =>
    c.env.ASSETS.fetch(c.req.raw).then(async (response) => {
      const blogPostSlug = c.req.param("postSlug");

      if (!response.headers.get("content-type")?.includes("text/html")) {
        return response;
      }

      const headers = new Headers(response.headers);
      headers.delete("content-length");

      return new Response(
        injectBlogPostShareTags(await response.text(), blogPostSlug),
        {
          headers,
          status: response.status,
          statusText: response.statusText,
        }
      );
    })
  )
  .all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
