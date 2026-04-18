import { LANDING_REPOSITORY_URL } from "./landing-config";
import {
  createLandingWorkerHandler,
  LANDING_CONNECT_PATH_PREFIX,
} from "./server/landing-worker";
import type { LandingWorkerBindings } from "./server/landing-worker";

type LandingWorkerEnv = CloudflareEnv & LandingWorkerBindings;

const landingWorkerHandler = createLandingWorkerHandler();

// RFC 9727 API catalog for automated discovery.
const apiCatalogBody = JSON.stringify({
  linkset: [
    {
      anchor: "https://onequery.dev/api/onequery.landing.v1.LandingService",
      "service-desc": [
        {
          href: `${LANDING_REPOSITORY_URL}/blob/main/proto/onequery/landing/v1/landing.proto`,
          type: "text/plain",
        },
      ],
      "service-doc": [
        {
          href: `${LANDING_REPOSITORY_URL}/blob/main/apps/landing/README.md`,
          type: "text/html",
        },
      ],
    },
  ],
});

export default {
  async fetch(
    request: Request,
    env: LandingWorkerEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/.well-known/api-catalog") {
      return new Response(apiCatalogBody, {
        headers: {
          "Content-Type": "application/linkset+json",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (url.pathname.startsWith(`${LANDING_CONNECT_PATH_PREFIX}/`)) {
      return landingWorkerHandler.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};
