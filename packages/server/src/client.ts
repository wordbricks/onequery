import type { ClientRequestOptions } from "hono/client";
import { hc } from "hono/client";

import type { ServerApiType } from "./app";

export function createApiClient(baseUrl = "", options?: ClientRequestOptions) {
  return hc<ServerApiType>(baseUrl, options);
}

export type ApiClient = ReturnType<typeof createApiClient>;

// Re-export type helpers for external use
export type { InferRequestType, InferResponseType } from "hono/client";
export type { ServerApiType };
