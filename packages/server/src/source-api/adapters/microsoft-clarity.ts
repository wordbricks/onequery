import type { MicrosoftClarityCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const MICROSOFT_CLARITY_DEFAULT_API_BASE_URL =
  "https://www.clarity.ms/export-data/api/v1";
const MICROSOFT_CLARITY_DESCRIPTOR_VERSION = "microsoft-clarity.v1";

export const microsoftClaritySourceApiAdapter =
  createSimpleRestSourceApiAdapter<MicrosoftClarityCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? MICROSOFT_CLARITY_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.apiToken,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /project-live-insights -f params[numOfDays]=1 -f params[dimension1]=OS`,
        description:
          "Fetch Clarity live dashboard insights for the last 24 hours grouped by OS.",
        label: "Live insights by OS",
      },
      {
        command: `onequery api --source ${sourceKey} /project-live-insights -f params[numOfDays]=3 -f params[dimension1]=URL -f params[dimension2]=Device`,
        description:
          "Fetch Clarity insights for the last 72 hours grouped by URL and device.",
        label: "Live insights by URL",
      },
    ],
    descriptorVersion: MICROSOFT_CLARITY_DESCRIPTOR_VERSION,
    notes: [
      "Microsoft Clarity Data Export API tokens are project-scoped and sent as Authorization bearer tokens.",
      "The live insights endpoint is limited to the previous 1 to 3 days and up to three dimensions.",
    ],
    operationNotes: [
      "Use `params[numOfDays]` with 1, 2, or 3.",
      "Use `params[dimension1]`, `params[dimension2]`, and `params[dimension3]` for Clarity-supported dimensions.",
    ],
    provider: "microsoft_clarity",
    providerLabel: "Microsoft Clarity",
  });
