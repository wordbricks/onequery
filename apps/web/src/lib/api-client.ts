import type { ApiClient } from "@onequery/self-host-runtime/client";
import { createApiClient as createRuntimeApiClient } from "@onequery/self-host-runtime/client";
import type { ClientRequestOptions } from "hono/client";

import { getApiBaseUrl } from "@/lib/api-base-url";

/**
 * Creates an API client for the full OneQuery API.
 * This includes routes exposed by the self-host runtime package.
 */
export function createApiClient(
  baseUrl = getApiBaseUrl(),
  options?: ClientRequestOptions
): ApiClient {
  return createRuntimeApiClient(baseUrl, options);
}
