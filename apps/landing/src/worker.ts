import { createLandingApp } from "./server/app";

type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

type LandingWorkerEnv = {
  ASSETS: AssetFetcher;
  LANDING_SLACK_WEBHOOK_URL?: string;
};

const landingApp = createLandingApp();

export default {
  async fetch(request: Request, env: LandingWorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return landingApp.fetch(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
