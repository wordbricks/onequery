import type { AmazonAdsCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const AMAZON_ADS_API_BASE_URLS = {
  eu: "https://advertising-api-eu.amazon.com",
  fe: "https://advertising-api-fe.amazon.com",
  na: "https://advertising-api.amazon.com",
} as const;
const AMAZON_ADS_DESCRIPTOR_VERSION = "amazon-ads.v1";

export const amazonAdsSourceApiAdapter =
  createSimpleRestSourceApiAdapter<AmazonAdsCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? AMAZON_ADS_API_BASE_URLS[credentials.region],
    auth: (credentials) => ({
      token: credentials.accessToken,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /v2/profiles`,
        description: "List Amazon Ads profiles visible to the access token.",
        label: "List profiles",
      },
      {
        command: `onequery api --source ${sourceKey} /sp/campaigns -f params[count]=100`,
        description:
          "List Sponsored Products campaigns for the configured profile.",
        label: "List SP campaigns",
      },
    ],
    defaultHeaders: (credentials) => ({
      "Amazon-Advertising-API-ClientId": credentials.clientId,
      ...(credentials.profileId
        ? { "Amazon-Advertising-API-Scope": credentials.profileId }
        : {}),
    }),
    descriptorVersion: AMAZON_ADS_DESCRIPTOR_VERSION,
    notes: [
      "Amazon Ads API requests require a Login with Amazon access token and the `Amazon-Advertising-API-ClientId` header.",
      "Requests for profile-scoped resources also require `Amazon-Advertising-API-Scope`; this adapter sends it when `profileId` is configured.",
    ],
    provider: "amazon_ads",
    providerLabel: "Amazon Ads",
  });
