import type { SentryCredentials } from "@onequery/db/server";
import { z } from "zod";

import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
import { fetchSentryApi } from "../../services/sentry/relay";
import { createProviderRoute } from "./create-provider-route";
import { parseProviderRequest } from "./query-validation";

const methodSchema = z.enum(["fetch_api"]);

const sentryFetchOptionsSchema = z.object({
  body: z.record(z.string(), z.unknown()).optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
});

const sentryFetchApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: sentryFetchOptionsSchema.optional(),
});

function isSentryCredentials(value: unknown): value is SentryCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "sentry"
  );
}

function buildConflictMessage(input: { multipleDefaults: boolean }): string {
  if (input.multipleDefaults) {
    return "Multiple default Sentry data sources found. Keep only one Sentry data source with useAsDataSource=true.";
  }

  return "Multiple active Sentry data sources found. Set exactly one as default (useAsDataSource=true).";
}

export const dataSourcesSentryQueryRoute = createProviderRoute<
  SentryCredentials,
  typeof methodSchema,
  z.output<typeof sentryFetchApiRequestSchema>
>({
  buildConflictMessage,
  credentialsGuard: isSentryCredentials,
  execute: ({ credentials, request }) =>
    fetchSentryApi({
      credentials,
      endpoint: request.endpoint,
      options: request.options,
    }),
  methodSchema,
  parseRequest: (input) =>
    parseProviderRequest(
      sentryFetchApiRequestSchema,
      input.request,
      "Invalid Sentry fetch_api request payload"
    ),
  provider: "sentry",
  providerLabel: "Sentry",
  routePath: "/sentry/query",
});
