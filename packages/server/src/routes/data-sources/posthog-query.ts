import type { PostHogCredentials } from "@onequery/db/server";

import {
  PostHogInvalidRequestError,
  isPostHogSourceCredentials,
  parsePostHogProviderRouteRequest,
  postHogSourceApiOperationSchema,
  requestPostHogSourceApi,
} from "../../source-api/adapters/posthog";
import { buildSourceApiRouteResponse } from "./build-source-api-route-response";
import { createProviderRoute } from "./create-provider-route";

export const dataSourcesPostHogQueryRoute = createProviderRoute<
  PostHogCredentials,
  typeof postHogSourceApiOperationSchema,
  {
    query: Record<string, unknown>;
    refresh?: string;
    timeoutMs?: number;
  },
  "/posthog/query"
>({
  credentialsGuard: isPostHogSourceCredentials,
  execute: async ({ c, credentials, request }) => {
    try {
      const response = await requestPostHogSourceApi({
        credentials,
        request,
      });

      return buildSourceApiRouteResponse(response);
    } catch (error) {
      if (error instanceof PostHogInvalidRequestError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  },
  methodSchema: postHogSourceApiOperationSchema,
  parseRequest: (input) =>
    parsePostHogProviderRouteRequest({
      request: input.request,
    }),
  provider: "posthog",
  providerLabel: "PostHog",
  routePath: "/posthog/query",
});
