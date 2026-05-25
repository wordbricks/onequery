import type { LinkedInAdsCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const LINKEDIN_ADS_DEFAULT_API_BASE_URL = "https://api.linkedin.com/rest";
const LINKEDIN_ADS_DESCRIPTOR_VERSION = "linkedin-ads.v1";

export const linkedInAdsSourceApiAdapter =
  createSimpleRestSourceApiAdapter<LinkedInAdsCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? LINKEDIN_ADS_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.accessToken,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /adAccounts -f params[q]=search`,
        description: "List LinkedIn ad accounts visible to the access token.",
        label: "List ad accounts",
      },
      {
        command: `onequery api --source ${sourceKey} /adCampaigns -f params[q]=search`,
        description:
          "List LinkedIn ad campaigns with Rest.li query params in the field patch.",
        label: "List campaigns",
      },
    ],
    defaultHeaders: (credentials) => ({
      "Linkedin-Version": credentials.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
    }),
    descriptorVersion: LINKEDIN_ADS_DESCRIPTOR_VERSION,
    notes: [
      "LinkedIn Marketing API calls require a `Linkedin-Version` header in `YYYYMM` format.",
      "The default LinkedIn API version is `202605`; set `credentials.apiVersion` to another supported version when needed.",
    ],
    provider: "linkedin_ads",
    providerLabel: "LinkedIn Ads",
  });
