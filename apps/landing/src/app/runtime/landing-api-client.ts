import type { ApplyGlobalResponse } from "hono/client";
import { hc } from "hono/client";

import type {
  LandingApp,
  LandingInternalProblemResponse,
  LandingServiceUnavailableProblemResponse,
  LandingValidationProblemResponse,
} from "../../server/landing/landing-app";

type LandingRpcApp = ApplyGlobalResponse<
  LandingApp,
  {
    422: { json: LandingValidationProblemResponse };
    500: { json: LandingInternalProblemResponse };
    503: { json: LandingServiceUnavailableProblemResponse };
  }
>;

// Same-origin: the worker serves the landing API under `/api`, and the typed
// `hc` client encodes the prefix from the route table itself.
export const landingApiClient = hc<LandingRpcApp>("");
