import type { OnePasswordCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const ONEPASSWORD_DESCRIPTOR_VERSION = "onepassword.v1";

export const onePasswordSourceApiAdapter =
  createSimpleRestSourceApiAdapter<OnePasswordCredentials>({
    allowedMethods: ["GET"],
    apiBaseUrl: (credentials) => credentials.apiBaseUrl,
    auth: (credentials) => ({
      token: credentials.accessToken,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /v1/vaults`,
        description: "List vaults visible to the connected Connect token.",
        label: "List vaults",
      },
      {
        command: `onequery api --source ${sourceKey} /v1/vaults/<vault-uuid>/items`,
        description: "List items in one vault.",
        label: "List vault items",
      },
      {
        command: `onequery api --source ${sourceKey} /v1/vaults/<vault-uuid>/items/<item-uuid>`,
        description: "Fetch one item from a vault.",
        label: "Get item",
      },
    ],
    descriptorVersion: ONEPASSWORD_DESCRIPTOR_VERSION,
    notes: [
      "1Password requests are sent to the configured Connect Server API base URL with Authorization bearer auth.",
      "Only GET requests are supported. Item and vault mutations are intentionally excluded.",
      "Use `params` in the field patch for Connect API query parameters such as `filter`.",
    ],
    operationNotes: [
      "Selectors should be Connect API paths such as `/v1/vaults` or `/v1/vaults/{vaultUUID}/items`.",
    ],
    provider: "onepassword",
    providerLabel: "1Password",
  });
