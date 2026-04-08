import type { ClientRequestOptions } from "hono/client";
import { hc } from "hono/client";

import type { ApiType } from "./app";

export function createApiClient(baseUrl = "", options?: ClientRequestOptions) {
  return hc<ApiType>(baseUrl, options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type { ApiType };
