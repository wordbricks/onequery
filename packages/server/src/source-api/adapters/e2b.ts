import type { E2BCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const E2B_DEFAULT_API_BASE_URL = "https://api.e2b.app";
const E2B_DESCRIPTOR_VERSION = "e2b.v1";

export const e2bSourceApiAdapter =
  createSimpleRestSourceApiAdapter<E2BCredentials>({
    allowedMethods: ["GET"],
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? E2B_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      type: "raw",
      value: credentials.apiKey,
    }),
    authHeaderName: "X-API-Key",
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /sandboxes`,
        description:
          "List running sandboxes visible to the connected E2B team.",
        label: "List running sandboxes",
      },
      {
        command: `onequery api --source ${sourceKey} /events/sandboxes -f params[limit]=20`,
        description: "List recent sandbox lifecycle events for the team.",
        label: "List sandbox events",
      },
      {
        command: `onequery api --source ${sourceKey} /v2/sandboxes/<sandbox-id>/logs`,
        description: "Fetch logs for one sandbox.",
        label: "Get sandbox logs",
      },
      {
        command: `onequery api --source ${sourceKey} /sandboxes/<sandbox-id>/metrics`,
        description: "Fetch metrics for one sandbox.",
        label: "Get sandbox metrics",
      },
    ],
    descriptorVersion: E2B_DESCRIPTOR_VERSION,
    notes: [
      "E2B API keys are sent in the X-API-Key header.",
      "This adapter allows GET requests only. Sandbox lifecycle mutations such as create, kill, pause, resume, refresh, and network updates are intentionally excluded.",
      "Use `/events/sandboxes` or `/events/sandboxes/{sandboxId}` to inspect lifecycle events.",
    ],
    operationNotes: [
      "Only read-only E2B API endpoints are supported.",
      "Use `params` in the field patch for E2B query string parameters such as `limit`, `offset`, and `orderAsc`.",
    ],
    provider: "e2b",
    providerLabel: "E2B",
  });
