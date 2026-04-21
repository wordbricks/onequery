import type { ApplyGlobalResponse, InferResponseType } from "hono/client";
import { hc } from "hono/client";

import type {
  LandingApp,
  LandingInternalErrorResponse,
} from "../../server/app";

type LandingRpcApp = ApplyGlobalResponse<
  LandingApp,
  {
    500: { json: LandingInternalErrorResponse };
  }
>;

// Same-origin: the worker serves the landing API under `/api`, and the typed
// `hc` client encodes the prefix from the route table itself.
export const landingApiClient = hc<LandingRpcApp>("");

export type LandingApiErrorResponse =
  | InferResponseType<
      (typeof landingApiClient.api)["product-updates"]["$post"],
      400 | 500 | 503
    >
  | InferResponseType<
      (typeof landingApiClient.api)["contact"]["$post"],
      400 | 500 | 503
    >;
