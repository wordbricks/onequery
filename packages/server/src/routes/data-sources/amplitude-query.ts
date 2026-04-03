import type { AmplitudeCredentials } from "@onequery/db/server";
import { z } from "zod";

import { fetchAmplitudeApi } from "../../services/amplitude/relay";
import type { AmplitudeFetchOptions } from "../../services/amplitude/relay";
import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
import { createProviderRoute } from "./create-provider-route";
import { parseProviderRequest } from "./query-validation";

const methodSchema = z.enum(["fetch_api"]);

const amplitudeFetchOptionsSchema = z.object({
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

const amplitudeFetchApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: amplitudeFetchOptionsSchema.optional(),
});

function isAmplitudeCredentials(value: unknown): value is AmplitudeCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "amplitude"
  );
}

export const dataSourcesAmplitudeQueryRoute = createProviderRoute<
  AmplitudeCredentials,
  typeof methodSchema,
  z.output<typeof amplitudeFetchApiRequestSchema>,
  "/amplitude/query"
>({
  credentialsGuard: isAmplitudeCredentials,
  execute: ({ credentials, request }) =>
    fetchAmplitudeApi({
      credentials,
      endpoint: request.endpoint,
      options: request.options as AmplitudeFetchOptions | undefined,
    }),
  methodSchema,
  parseRequest: (input) =>
    parseProviderRequest(
      amplitudeFetchApiRequestSchema,
      input.request,
      "Invalid Amplitude fetch_api request payload"
    ),
  provider: "amplitude",
  providerLabel: "Amplitude",
  routePath: "/amplitude/query",
});
