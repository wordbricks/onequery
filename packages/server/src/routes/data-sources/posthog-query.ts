import type { PostHogCredentials } from "@onequery/db/server";
import { z } from "zod";

import { runPostHogQuery } from "../../services/posthog/relay";
import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
import { createProviderRoute } from "./create-provider-route";
import { parseProviderRequest } from "./query-validation";

const methodSchema = z.enum(["run_query"]);

const postHogRunQueryRequestSchema = z.object({
  query: z.record(z.string(), z.unknown()),
  refresh: z.string().min(1).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
});

function isPostHogCredentials(value: unknown): value is PostHogCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "posthog"
  );
}

export const dataSourcesPostHogQueryRoute = createProviderRoute<
  PostHogCredentials,
  typeof methodSchema,
  z.output<typeof postHogRunQueryRequestSchema>,
  "/posthog/query"
>({
  credentialsGuard: isPostHogCredentials,
  execute: ({ credentials, request }) =>
    runPostHogQuery({
      credentials,
      query: request.query,
      refresh: request.refresh,
      timeoutMs: request.timeoutMs,
    }),
  methodSchema,
  parseRequest: (input) =>
    parseProviderRequest(
      postHogRunQueryRequestSchema,
      input.request,
      "Invalid PostHog run_query request payload"
    ),
  provider: "posthog",
  providerLabel: "PostHog",
  routePath: "/posthog/query",
});
