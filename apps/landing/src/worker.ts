import { LANDING_REPOSITORY_URL } from "./landing-config";
import { createLandingApp } from "./server/app";

type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

type LandingWorkerEnv = {
  ASSETS: AssetFetcher;
  LANDING_SLACK_WEBHOOK_URL?: string;
};

const landingApp = createLandingApp();

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
  async fetch(request: Request, env: LandingWorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/.well-known/api-catalog") {
      return new Response(apiCatalogBody, {
        headers: {
          "Content-Type": "application/linkset+json",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return landingApp.fetch(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
