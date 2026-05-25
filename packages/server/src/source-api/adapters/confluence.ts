import type { ConfluenceCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const CONFLUENCE_DESCRIPTOR_VERSION = "confluence.v1";

export const confluenceSourceApiAdapter =
  createSimpleRestSourceApiAdapter<ConfluenceCredentials>({
    apiBaseUrl: (credentials) => `${credentials.siteUrl}/wiki/api/v2`,
    auth: (credentials) => ({
      password: credentials.apiToken,
      type: "basic",
      username: credentials.email,
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /pages -f params[limit]=25`,
        description: "List Confluence pages visible to the API token.",
        label: "List pages",
      },
      {
        command: `onequery api --source ${sourceKey} /spaces -f params[limit]=25`,
        description: "List Confluence spaces visible to the API token.",
        label: "List spaces",
      },
    ],
    descriptorVersion: CONFLUENCE_DESCRIPTOR_VERSION,
    notes: [
      "This adapter targets Confluence Cloud REST API v2 under `/wiki/api/v2`.",
    ],
    provider: "confluence",
    providerLabel: "Confluence",
  });
