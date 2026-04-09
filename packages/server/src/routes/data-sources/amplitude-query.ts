import type { AmplitudeCredentials } from "@onequery/db/server";

import type { AmplitudeProviderRouteRequest } from "../../source-api/adapters/amplitude";
import {
  AmplitudeInvalidRequestError,
  amplitudeSourceApiOperationSchema,
  isAmplitudeSourceCredentials,
  parseAmplitudeProviderRouteRequest,
  requestAmplitudeSourceApi,
} from "../../source-api/adapters/amplitude";
import { buildSourceApiRouteResponse } from "./build-source-api-route-response";
import { createProviderRoute } from "./create-provider-route";

export const dataSourcesAmplitudeQueryRoute = createProviderRoute<
  AmplitudeCredentials,
  typeof amplitudeSourceApiOperationSchema,
  AmplitudeProviderRouteRequest,
  "/amplitude/query"
>({
  credentialsGuard: isAmplitudeSourceCredentials,
  execute: async ({ c, credentials, request }) => {
    try {
      const response = await requestAmplitudeSourceApi({
        body: request.body,
        credentials,
        method: request.method ?? "GET",
        params: request.params,
        selector: request.selector,
        timeoutMs: request.timeoutMs,
      });

      return buildSourceApiRouteResponse(response);
    } catch (error) {
      if (error instanceof AmplitudeInvalidRequestError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  },
  methodSchema: amplitudeSourceApiOperationSchema,
  parseRequest: (input) =>
    parseAmplitudeProviderRouteRequest({
      request: input.request,
    }),
  provider: "amplitude",
  providerLabel: "Amplitude",
  routePath: "/amplitude/query",
});
