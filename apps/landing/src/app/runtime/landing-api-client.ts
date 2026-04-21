import { hc } from "hono/client";

import type { LandingApp } from "../../server/landing/landing-app";

// Same-origin: the worker serves the landing API under `/api`, and the typed
// `hc` client encodes the prefix from the route table itself.
export const landingApiClient = hc<LandingApp>("");
