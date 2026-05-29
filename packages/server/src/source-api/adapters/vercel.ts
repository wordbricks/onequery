import type { VercelCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const VERCEL_DEFAULT_API_BASE_URL = "https://api.vercel.com";
const VERCEL_DESCRIPTOR_VERSION = "vercel.v1";

export const vercelSourceApiAdapter =
  createSimpleRestSourceApiAdapter<VercelCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? VERCEL_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.apiToken,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /v9/projects`,
        description: "List projects visible to the connected Vercel token.",
        label: "List projects",
      },
      {
        command: `onequery api --source ${sourceKey} /v6/deployments -f params[limit]=20`,
        description: "List recent deployments visible to the connected token.",
        label: "List deployments",
      },
      {
        command: `onequery api --source ${sourceKey} /v2/teams`,
        description: "List teams available to the connected Vercel token.",
        label: "List teams",
      },
    ],
    descriptorVersion: VERCEL_DESCRIPTOR_VERSION,
    notes: [
      "Vercel API tokens are sent as Authorization bearer tokens.",
      "Pass `params[teamId]` for team-scoped Vercel endpoints when needed.",
    ],
    provider: "vercel",
    providerLabel: "Vercel",
  });
