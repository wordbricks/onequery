import type { SentryCredentials } from "@onequery/db/server";

import type { SentryProviderRouteRequest } from "../../source-api/adapters/sentry";
import {
  SentryInvalidRequestError,
  isSentrySourceCredentials,
  parseSentryProviderRouteRequest,
  requestSentrySourceApi,
  sentrySourceApiOperationSchema,
} from "../../source-api/adapters/sentry";
import { buildSourceApiRouteResponse } from "./build-source-api-route-response";
import { createProviderRoute } from "./create-provider-route";

function buildConflictMessage(input: { multipleDefaults: boolean }): string {
  if (input.multipleDefaults) {
    return "Multiple default Sentry data sources found. Keep only one Sentry data source with useAsDataSource=true.";
  }

  return "Multiple active Sentry data sources found. Set exactly one as default (useAsDataSource=true).";
}

export const dataSourcesSentryQueryRoute = createProviderRoute<
  SentryCredentials,
  typeof sentrySourceApiOperationSchema,
  SentryProviderRouteRequest,
  "/sentry/query"
>({
  buildConflictMessage,
  credentialsGuard: isSentrySourceCredentials,
  execute: async ({ c, credentials, request }) => {
    try {
      const response = await requestSentrySourceApi({
        body: request.body,
        credentials,
        method: request.method ?? "GET",
        params: request.params,
        selector: request.selector,
        timeoutMs: request.timeoutMs,
      });

      return buildSourceApiRouteResponse(response);
    } catch (error) {
      if (error instanceof SentryInvalidRequestError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  },
  methodSchema: sentrySourceApiOperationSchema,
  parseRequest: (input) =>
    parseSentryProviderRouteRequest({
      request: input.request,
    }),
  provider: "sentry",
  providerLabel: "Sentry",
  routePath: "/sentry/query",
});
