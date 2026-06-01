import { API_PREFIX } from "@/shared/config/api";

const API_CATALOG_PATH = "/.well-known/api-catalog";
const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';
const ONEQUERY_REPOSITORY_URL = "https://github.com/wordbricks/onequery";
const ONEQUERY_README_URL = `${ONEQUERY_REPOSITORY_URL}/blob/main/README.md`;
const ONEQUERY_DOCS_URL = "https://onequery.dev/docs/";
const ONEQUERY_PROTO_README_URL = `${ONEQUERY_REPOSITORY_URL}/blob/main/proto/README.md`;
const ONEQUERY_CLI_PROTO_URL =
  "https://raw.githubusercontent.com/wordbricks/onequery/main/proto/onequery/cli/v1/cli.proto";

export const AGENT_DISCOVERY_LINK_HEADER = [
  `<${API_CATALOG_PATH}>; rel="api-catalog"; type="application/linkset+json"`,
  `<${ONEQUERY_CLI_PROTO_URL}>; rel="service-desc"; type="text/plain"`,
  `<${ONEQUERY_DOCS_URL}>; rel="service-doc"; type="text/html"`,
  `<${ONEQUERY_README_URL}>; rel="describedby"; type="text/html"`,
].join(", ");

export function buildApiCatalogLinkset(origin: string) {
  const homepageUrl = `${origin}/`;
  const catalogUrl = `${origin}${API_CATALOG_PATH}`;
  const productUpdatesApiUrl = `${origin}${API_PREFIX}/product-updates/`;
  const contactApiUrl = `${origin}${API_PREFIX}/contact/`;

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

export function createApiCatalogResponse(request: Request) {
  const headers = new Headers({
    "content-type": API_CATALOG_CONTENT_TYPE,
    Link: AGENT_DISCOVERY_LINK_HEADER,
    "X-Robots-Tag": "noindex",
  });

  if (request.method === "HEAD") {
    return new Response(null, { headers });
  }

  return new Response(
    `${JSON.stringify(buildApiCatalogLinkset(new URL(request.url).origin), null, 2)}\n`,
    {
      headers,
    }
  );
}
