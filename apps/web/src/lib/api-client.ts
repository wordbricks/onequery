import type { ApiClient } from "@onequery/bun-server/client";
import { createApiClient as createBunApiClient } from "@onequery/bun-server/client";
import type { ClientRequestOptions } from "hono/client";

import { getApiBaseUrl } from "@/lib/api-base-url";

/**
 * Creates an API client for the full OneQuery API.
 * This includes routes exposed by the Bun-owned OSS runtime.
 */
export function createApiClient(
  baseUrl = getApiBaseUrl(),
  options?: ClientRequestOptions
): ApiClient {
  return createBunApiClient(baseUrl, options);
}
