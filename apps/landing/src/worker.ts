import {
  LANDING_API_CATALOG_PATH,
  LANDING_CONNECT_PATH_PREFIX,
  LANDING_SERVICE_NAME,
} from "./landing-api";
import { LANDING_PROTO_SOURCE_URL } from "./landing-config";
import { createLandingWorkerHandler } from "./server/landing-worker";
import type { LandingWorkerBindings } from "./server/landing-worker";

type LandingWorkerEnv = CloudflareEnv & LandingWorkerBindings;

const landingWorkerHandler = createLandingWorkerHandler();
const API_CATALOG_MEDIA_TYPE = "application/linkset+json" as const;
const API_CATALOG_PROFILE_URI =
  "https://www.rfc-editor.org/info/rfc9727" as const;
const API_CATALOG_LINK_HEADER =
  `<${LANDING_API_CATALOG_PATH}>; rel="api-catalog"; type="${API_CATALOG_MEDIA_TYPE}"` as const;
const DISCOVERY_LINK_HEADERS = [API_CATALOG_LINK_HEADER] as const;
const HOMEPAGE_PATHS = new Set(["/", "/index.html"]);

const API_CATALOG_HEADERS = {
  "Cache-Control": "public, max-age=3600",
  "Content-Type": `${API_CATALOG_MEDIA_TYPE}; profile="${API_CATALOG_PROFILE_URI}"`,
} as const;

function appendLinkHeaders(response: Response, linkValues: readonly string[]) {
  if (linkValues.length === 0) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const linkValue of linkValues) {
    headers.append("Link", linkValue);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function shouldAdvertiseApiCatalog(url: URL, response: Response) {
  if (!HOMEPAGE_PATHS.has(url.pathname)) {
    return false;
  }

  return response.headers.get("Content-Type")?.includes("text/html") ?? false;
}

function createApiCatalog(origin: string) {
  return {
    linkset: [
      {
        anchor: new URL(
          `${LANDING_CONNECT_PATH_PREFIX}/${LANDING_SERVICE_NAME}`,
          origin
        ).toString(),
        // Comment: omit service-doc until the landing RPC has a stable public
        // document target instead of the previously broken README link.
        "service-desc": [
          {
            href: LANDING_PROTO_SOURCE_URL,
            type: "text/plain",
          },
        ],
      },
    ],
  };
}

const worker: ExportedHandler<LandingWorkerEnv> = {
  async fetch(
    request: Request,
    env: LandingWorkerEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === LANDING_API_CATALOG_PATH) {
      return appendLinkHeaders(
        new Response(JSON.stringify(createApiCatalog(url.origin)), {
          headers: API_CATALOG_HEADERS,
        }),
        DISCOVERY_LINK_HEADERS
      );
    }

    if (
      url.pathname === LANDING_CONNECT_PATH_PREFIX ||
      url.pathname.startsWith(`${LANDING_CONNECT_PATH_PREFIX}/`)
    ) {
      return landingWorkerHandler.fetch(request, env, ctx);
    }

    // The homepage HTML is emitted by the asset binding, so discovery headers
    // belong at the worker boundary instead of inside TanStack Router routes.
    const assetResponse = await env.ASSETS.fetch(request);
    if (!shouldAdvertiseApiCatalog(url, assetResponse)) {
      return assetResponse;
    }

    return appendLinkHeaders(assetResponse, DISCOVERY_LINK_HEADERS);
  },
};

export default worker;
