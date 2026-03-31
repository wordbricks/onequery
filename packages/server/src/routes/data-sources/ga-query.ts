import { isRecord } from "@onequery/base";
import type { GoogleAnalyticsCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  resolveGoogleAnalyticsAccessToken,
  resolveGoogleAnalyticsPropertyPath,
  runGoogleAnalyticsDataRequest,
} from "../../services/google-analytics/relay";
import { createProviderRoute } from "./create-provider-route";
import { createPrefixedQueryError, createQueryError } from "./query-errors";

const methodSchema = z.enum(["run_report", "run_realtime_report"]);

function isGoogleAnalyticsCredentials(
  value: unknown
): value is GoogleAnalyticsCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "ga"
  );
}

export const dataSourcesGaQueryRoute = createProviderRoute<
  GoogleAnalyticsCredentials,
  typeof methodSchema,
  Record<string, unknown>
>({
  buildConflictMessage: ({ multipleDefaults }) =>
    multipleDefaults
      ? "Multiple default Google Analytics data sources found. Keep only one GA data source with useAsDataSource=true."
      : "Multiple active Google Analytics data sources found. Set exactly one as default (useAsDataSource=true).",
  credentialsGuard: isGoogleAnalyticsCredentials,
  execute: async ({ c, credentials, method, request }) => {
    const propertyPath = resolveGoogleAnalyticsPropertyPath({
      credentials,
      request,
    });
    if (!propertyPath) {
      return c.json(
        {
          error:
            "Property ID is required in request or saved data source credentials",
        },
        400
      );
    }

    const tokenOutcome = await resolveGoogleAnalyticsAccessToken({
      credentials,
    })
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));
    if (!tokenOutcome.ok) {
      return c.json(
        createPrefixedQueryError(
          "Failed to get Google access token",
          tokenOutcome.error
        ),
        500
      );
    }

    const requestBody = { ...request };
    delete requestBody.property;
    const gaResponse = await runGoogleAnalyticsDataRequest({
      accessToken: tokenOutcome.value.accessToken,
      method,
      propertyPath,
      requestBody,
    });
    if (!gaResponse.ok) {
      const errorText = await gaResponse.text().catch(() => "Unknown error");
      return Response.json(
        createQueryError(
          `Google Analytics Data API error: ${gaResponse.status} ${errorText}`
        ),
        {
          headers: { "Content-Type": "application/json" },
          status: gaResponse.status,
        }
      );
    }

    const gaResult = await gaResponse
      .json()
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ error, ok: false as const }));
    if (!gaResult.ok) {
      return c.json(
        createPrefixedQueryError("Failed to parse GA response", gaResult.error),
        500
      );
    }

    if (!isRecord(gaResult.value)) {
      return c.json(
        {
          error: "Unexpected Google Analytics response format",
        },
        500
      );
    }

    return c.json({
      ...gaResult.value,
      _onequery: {
        resolvedPropertyPath: propertyPath,
      },
    });
  },
  methodSchema,
  missingDataSourceMessage: "Active Google Analytics data source not found",
  parseRequest: (input) => ({ data: input.request, ok: true }),
  provider: "ga",
  providerLabel: "Google Analytics",
  routePath: "/ga/query",
});
