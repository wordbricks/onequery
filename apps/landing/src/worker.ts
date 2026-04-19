import {
  LANDING_API_CATALOG_PATH,
  LANDING_CONNECT_PATH_PREFIX,
  LANDING_SERVICE_NAME,
} from "./landing-api";
import { LANDING_PROTO_SOURCE_URL } from "./landing-config";
import {
  createLandingWorkerHandler,
} from "./server/landing-worker";
import type { LandingWorkerBindings } from "./server/landing-worker";

type LandingWorkerEnv = CloudflareEnv & LandingWorkerBindings;

const landingWorkerHandler = createLandingWorkerHandler();

const API_CATALOG_HEADERS = {
  "Cache-Control": "public, max-age=3600",
  "Content-Type": "application/linkset+json",
} as const;

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
      return new Response(JSON.stringify(createApiCatalog(url.origin)), {
        headers: API_CATALOG_HEADERS,
      });
    }

    if (
      url.pathname === LANDING_CONNECT_PATH_PREFIX ||
      url.pathname.startsWith(`${LANDING_CONNECT_PATH_PREFIX}/`)
    ) {
      return landingWorkerHandler.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;
