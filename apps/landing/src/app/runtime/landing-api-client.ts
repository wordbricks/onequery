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

export type ProductUpdatesPost =
  (typeof landingApiClient.api)["product-updates"]["$post"];

export type ContactPost = (typeof landingApiClient.api)["contact"]["$post"];

export type ProductUpdatesSuccessResponse = InferResponseType<
  ProductUpdatesPost,
  200
>;

export type ProductUpdatesServiceUnavailableErrorResponse = InferResponseType<
  ProductUpdatesPost,
  503
>;

export type ContactServiceUnavailableErrorResponse = InferResponseType<
  ContactPost,
  503
>;

export type LandingProblemResponse =
  | {
      body: LandingInternalErrorResponse;
      status: 500;
    }
  | {
      body:
        | ProductUpdatesServiceUnavailableErrorResponse
        | ContactServiceUnavailableErrorResponse;
      status: 503;
    };
