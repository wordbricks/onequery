import type { GoogleAnalyticsCredentials } from "@onequery/db/server";

import {
  GoogleAnalyticsAccessTokenError,
  GoogleAnalyticsInvalidRequestError,
  googleAnalyticsSourceApiOperationSchema,
  isGoogleAnalyticsSourceCredentials,
  requestGoogleAnalyticsSourceApi,
} from "../../source-api/adapters/ga";
import { buildSourceApiRouteResponse } from "./build-source-api-route-response";
import { createProviderRoute } from "./create-provider-route";
import { createPrefixedQueryError } from "./query-errors";

export const dataSourcesGaQueryRoute = createProviderRoute<
  GoogleAnalyticsCredentials,
  typeof googleAnalyticsSourceApiOperationSchema,
  Record<string, unknown>,
  "/ga/query"
>({
  buildConflictMessage: ({ multipleDefaults }) =>
    multipleDefaults
      ? "Multiple default Google Analytics data sources found. Keep only one GA data source with useAsDataSource=true."
      : "Multiple active Google Analytics data sources found. Set exactly one as default (useAsDataSource=true).",
  credentialsGuard: isGoogleAnalyticsSourceCredentials,
  execute: async ({ c, credentials, method, request }) => {
    const outcome = await requestGoogleAnalyticsSourceApi({
      credentials,
      operation: method,
      request,
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));

    if (!outcome.ok) {
      if (outcome.error instanceof GoogleAnalyticsInvalidRequestError) {
        return c.json({ error: outcome.error.message }, 400);
      }
      if (outcome.error instanceof GoogleAnalyticsAccessTokenError) {
        return c.json(
          createPrefixedQueryError(
            "Failed to get Google access token",
            outcome.error.message
          ),
          500
        );
      }

      return c.json(
        createPrefixedQueryError(
          "Google Analytics relay request failed",
          outcome.error
        ),
        502
      );
    }

    return buildSourceApiRouteResponse(outcome.value);
  },
  methodSchema: googleAnalyticsSourceApiOperationSchema,
  missingDataSourceMessage: "Active Google Analytics data source not found",
  parseRequest: (input) => ({ data: input.request, ok: true }),
  provider: "ga",
  providerLabel: "Google Analytics",
  routePath: "/ga/query",
});
