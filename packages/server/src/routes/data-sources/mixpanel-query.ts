import type { MixpanelCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  exportMixpanelEvents,
  fetchMixpanelQueryApi,
  MAX_MIXPANEL_ENGAGE_PAGE_SIZE,
  queryMixpanelEngage,
  queryMixpanelSegmentation,
} from "../../services/mixpanel/relay";
import type { MixpanelFetchOptions } from "../../services/mixpanel/relay";
import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
import { createProviderRoute } from "./create-provider-route";
import { parseProviderRequest } from "./query-validation";

const methodSchema = z.enum([
  "query_engage",
  "query_segmentation",
  "fetch_query_api",
  "export_events",
]);

const mixpanelEngageRequestSchema = z.object({
  outputProperties: z.array(z.string().min(1)).optional(),
  page: z.number().int().min(0).optional(),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_MIXPANEL_ENGAGE_PAGE_SIZE)
    .optional(),
  where: z.string().min(1).optional(),
});

const mixpanelSegmentationRequestSchema = z.object({
  event: z.string().min(1),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  type: z.enum(["general", "unique", "average"]).optional(),
  unit: z.enum(["hour", "day", "week", "month"]).optional(),
  where: z.string().min(1).optional(),
});

const mixpanelFetchOptionsSchema = z.object({
  body: z.record(z.string(), z.unknown()).optional(),
  bodyFormat: z.enum(["form", "json"]).optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
});

const mixpanelFetchQueryApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: mixpanelFetchOptionsSchema.optional(),
});

const mixpanelExportEventsRequestSchema = z.object({
  options: mixpanelFetchOptionsSchema.optional(),
});

type MixpanelRequest =
  | {
      kind: "export_events";
      options?: z.output<typeof mixpanelFetchOptionsSchema>;
    }
  | {
      kind: "fetch_query_api";
      endpoint: string;
      options?: z.output<typeof mixpanelFetchOptionsSchema>;
    }
  | {
      kind: "query_engage";
      request: z.output<typeof mixpanelEngageRequestSchema>;
    }
  | {
      kind: "query_segmentation";
      request: z.output<typeof mixpanelSegmentationRequestSchema>;
    };

function isMixpanelCredentials(value: unknown): value is MixpanelCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "mixpanel"
  );
}

export const dataSourcesMixpanelQueryRoute = createProviderRoute<
  MixpanelCredentials,
  typeof methodSchema,
  MixpanelRequest,
  "/mixpanel/query"
>({
  credentialsGuard: isMixpanelCredentials,
  execute: ({ credentials, request }) => {
    if (request.kind === "query_engage") {
      return queryMixpanelEngage({
        credentials,
        request: request.request,
      });
    }
    if (request.kind === "query_segmentation") {
      return queryMixpanelSegmentation({
        credentials,
        request: request.request,
      });
    }
    if (request.kind === "fetch_query_api") {
      return fetchMixpanelQueryApi({
        credentials,
        endpoint: request.endpoint,
        options: request.options as MixpanelFetchOptions | undefined,
      });
    }

    return exportMixpanelEvents({
      credentials,
      options: request.options as MixpanelFetchOptions | undefined,
    });
  },
  methodSchema,
  parseRequest: (input) => {
    if (input.method === "query_engage") {
      const parsed = parseProviderRequest(
        mixpanelEngageRequestSchema,
        input.request,
        "Invalid Mixpanel engage request payload"
      );
      return parsed.ok
        ? { data: { kind: "query_engage", request: parsed.data }, ok: true }
        : parsed;
    }

    if (input.method === "query_segmentation") {
      const parsed = parseProviderRequest(
        mixpanelSegmentationRequestSchema,
        input.request,
        "Invalid Mixpanel segmentation request payload"
      );
      return parsed.ok
        ? {
            data: { kind: "query_segmentation", request: parsed.data },
            ok: true,
          }
        : parsed;
    }

    if (input.method === "fetch_query_api") {
      const parsed = parseProviderRequest(
        mixpanelFetchQueryApiRequestSchema,
        input.request,
        "Invalid Mixpanel query API request payload"
      );
      return parsed.ok
        ? {
            data: {
              endpoint: parsed.data.endpoint,
              kind: "fetch_query_api",
              options: parsed.data.options,
            },
            ok: true,
          }
        : parsed;
    }

    const parsed = parseProviderRequest(
      mixpanelExportEventsRequestSchema,
      input.request,
      "Invalid Mixpanel export events request payload"
    );
    return parsed.ok
      ? {
          data: {
            kind: "export_events",
            options: parsed.data.options,
          },
          ok: true,
        }
      : parsed;
  },
  provider: "mixpanel",
  providerLabel: "Mixpanel",
  routePath: "/mixpanel/query",
});
