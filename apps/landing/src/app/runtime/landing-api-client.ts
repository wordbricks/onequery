import type { ApplyGlobalResponse, InferResponseType } from "hono/client";
import { hc } from "hono/client";

import type {
  LandingApp,
  LandingInternalProblemResponse,
} from "../../server/landing/landing-app";

type LandingRpcApp = ApplyGlobalResponse<
  LandingApp,
  {
    500: { json: LandingInternalProblemResponse };
  }
>;

// Same-origin: the worker serves the landing API under `/api`, and the typed
// `hc` client encodes the prefix from the route table itself.
export const landingApiClient = hc<LandingRpcApp>("");

export type ProductUpdatesPost =
  (typeof landingApiClient.api)["product-updates"]["$post"];

export type ContactPost = (typeof landingApiClient.api)["contact"]["$post"];

export type LandingProblemStatus = 422 | 500 | 503;

export type ProductUpdatesSuccessResponse = InferResponseType<
  ProductUpdatesPost,
  200
>;

export type ProductUpdatesProblemResponse = InferResponseType<
  ProductUpdatesPost,
  LandingProblemStatus
>;

export type ContactProblemResponse = InferResponseType<
  ContactPost,
  LandingProblemStatus
>;

export type LandingProblemResponse =
  | ProductUpdatesProblemResponse
  | ContactProblemResponse;
