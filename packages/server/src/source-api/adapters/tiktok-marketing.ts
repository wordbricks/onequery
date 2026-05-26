import type { TikTokMarketingCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const TIKTOK_MARKETING_DEFAULT_API_BASE_URL =
  "https://business-api.tiktok.com/open_api/v1.3";
const TIKTOK_MARKETING_DESCRIPTOR_VERSION = "tiktok-marketing.v1";

export const tiktokMarketingSourceApiAdapter =
  createSimpleRestSourceApiAdapter<TikTokMarketingCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? TIKTOK_MARKETING_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      type: "raw",
      value: credentials.accessToken,
    }),
    authHeaderName: "Access-Token",
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /advertiser/info/ -f params[advertiser_ids]='["1234567890"]'`,
        description: "Fetch TikTok advertiser account metadata.",
        label: "Get advertiser info",
      },
      {
        command: `onequery api --source ${sourceKey} /campaign/get/ -f params[advertiser_id]=1234567890`,
        description: "List campaigns for a TikTok advertiser account.",
        label: "List campaigns",
      },
    ],
    descriptorVersion: TIKTOK_MARKETING_DESCRIPTOR_VERSION,
    notes: [
      "TikTok API for Business uses the `Access-Token` request header instead of an Authorization bearer header.",
      "Most TikTok Marketing API endpoints require an advertiser ID in request params or the request body.",
    ],
    operationNotes: [
      "Selectors are relative to `/open_api/v1.3`, for example `/advertiser/info/`.",
    ],
    provider: "tiktok_marketing",
    providerLabel: "TikTok Marketing",
  });
