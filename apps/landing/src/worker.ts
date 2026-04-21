import { LANDING_API_PREFIX } from "./landing/config/landing-api";
import { createLandingApp } from "./server/landing/landing-app";
import type { LandingWorkerBindings } from "./server/landing/landing-app";

type LandingWorkerEnv = CloudflareEnv & LandingWorkerBindings;

const landingApp = createLandingApp();

const worker: ExportedHandler<LandingWorkerEnv> = {
  fetch(
    request: Request,
    env: LandingWorkerEnv,
    ctx: ExecutionContext
  ): Response | Promise<Response> {
    const url = new URL(request.url);

    if (
      url.pathname === LANDING_API_PREFIX ||
      url.pathname.startsWith(`${LANDING_API_PREFIX}/`)
    ) {
      return landingApp.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;
