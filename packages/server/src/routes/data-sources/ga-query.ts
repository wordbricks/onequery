import type { GoogleAnalyticsCredentials } from "@onequery/db/server";

import {
  GoogleAnalyticsAccessTokenError,
  GoogleAnalyticsInvalidRequestError,
  googleAnalyticsSourceApiOperationSchema,
  isGoogleAnalyticsSourceCredentials,
  requestGoogleAnalyticsSourceApi,
} from "../../source-api/adapters/ga";
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

    return buildGoogleAnalyticsRouteResponse(outcome.value);
  },
  methodSchema: googleAnalyticsSourceApiOperationSchema,
  missingDataSourceMessage: "Active Google Analytics data source not found",
  parseRequest: (input) => ({ data: input.request, ok: true }),
  provider: "ga",
  providerLabel: "Google Analytics",
  routePath: "/ga/query",
});

function buildGoogleAnalyticsRouteResponse(input: {
  body:
    | { kind: "none" }
    | { kind: "json"; value: unknown }
    | { kind: "text"; value: string }
    | { kind: "binary"; value: Uint8Array };
  contentType: string;
  headers: { name: string; value: string }[];
  status: number;
}) {
  const headers = new Headers();
  for (const header of input.headers) {
    headers.set(header.name, header.value);
  }
  if (input.contentType.trim().length > 0 && !headers.has("content-type")) {
    headers.set("content-type", input.contentType);
  }

  switch (input.body.kind) {
    case "none":
      return new Response(null, {
        headers,
        status: input.status,
      });
    case "json":
      return new Response(JSON.stringify(input.body.value), {
        headers,
        status: input.status,
      });
    case "text":
      return new Response(input.body.value, {
        headers,
        status: input.status,
      });
    case "binary":
      return new Response(copyBinaryBody(input.body.value), {
        headers,
        status: input.status,
      });
  }
}

function copyBinaryBody(value: Uint8Array): ArrayBuffer {
  const copied = new Uint8Array(value.byteLength);
  copied.set(value);
  return copied.buffer;
}
