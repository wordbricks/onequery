import { REPOSITORY_URL } from "@/shared/config/site";
import { ONEQUERY } from "@/shared/seo/constants";

const API_CATALOG_PATH = "/.well-known/api-catalog/";
const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';
const API_CATALOG_LINKS = {
  CLI_PROTO:
    "https://raw.githubusercontent.com/wordbricks/onequery/main/proto/onequery/cli/v1/cli.proto",
  DOCS: `${ONEQUERY.SITE_URL}/docs/`,
  PROTO_README: `${REPOSITORY_URL}/blob/main/proto/README.md`,
  README: `${REPOSITORY_URL}/blob/main/README.md`,
} as const;

export const AGENT_DISCOVERY_LINK_HEADER = [
  `<${API_CATALOG_PATH}>; rel="api-catalog"; type="application/linkset+json"`,
  `<${API_CATALOG_LINKS.CLI_PROTO}>; rel="service-desc"; type="text/plain"`,
  `<${API_CATALOG_LINKS.DOCS}>; rel="service-doc"; type="text/html"`,
  `<${API_CATALOG_LINKS.README}>; rel="describedby"; type="text/html"`,
].join(", ");

export function buildApiCatalogLinkset(origin: string) {
  const homepageUrl = `${origin}/`;
  const catalogUrl = `${origin}${API_CATALOG_PATH}`;

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
            href: API_CATALOG_LINKS.README,
            title: "OneQuery README",
            type: "text/html",
          },
        ],
        "service-desc": [
          {
            href: API_CATALOG_LINKS.CLI_PROTO,
            title: "OneQuery CLI Connect RPC protobuf schema",
            type: "text/plain",
          },
        ],
        "service-doc": [
          {
            href: API_CATALOG_LINKS.DOCS,
            title: "OneQuery documentation",
            type: "text/html",
          },
        ],
      },
      {
        anchor: API_CATALOG_LINKS.CLI_PROTO,
        describedby: [
          {
            href: API_CATALOG_LINKS.PROTO_README,
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
