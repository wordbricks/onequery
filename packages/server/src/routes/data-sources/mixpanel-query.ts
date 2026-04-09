import type { MixpanelCredentials } from "@onequery/db/server";

import type { MixpanelSourceApiRequest } from "../../source-api/adapters/mixpanel";
import {
  isMixpanelSourceCredentials,
  mixpanelSourceApiOperationSchema,
  parseMixpanelProviderRouteRequest,
  requestMixpanelSourceApi,
  MixpanelInvalidRequestError,
} from "../../source-api/adapters/mixpanel";
import { buildSourceApiRouteResponse } from "./build-source-api-route-response";
import { createProviderRoute } from "./create-provider-route";

export const dataSourcesMixpanelQueryRoute = createProviderRoute<
  MixpanelCredentials,
  typeof mixpanelSourceApiOperationSchema,
  MixpanelSourceApiRequest,
  "/mixpanel/query"
>({
  credentialsGuard: isMixpanelSourceCredentials,
  execute: async ({ c, credentials, request }) => {
    try {
      const response = await requestMixpanelSourceApi({
        ...request,
        credentials,
      });

      return buildSourceApiRouteResponse(response);
    } catch (error) {
      if (error instanceof MixpanelInvalidRequestError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  },
  methodSchema: mixpanelSourceApiOperationSchema,
  parseRequest: (input) =>
    parseMixpanelProviderRouteRequest({
      operation: input.method,
      request: input.request,
    }),
  provider: "mixpanel",
  providerLabel: "Mixpanel",
  routePath: "/mixpanel/query",
});
