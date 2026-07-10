import type { HermesCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const HERMES_DESCRIPTOR_VERSION = "hermes.v2";
// Comment: `/api/cron/fire` deliberately stays outside this allowlist-backed
// adapter because Hermes authenticates it with a short-lived Chronos JWT, not
// the source's API_SERVER_KEY. Allowing callers to replace Authorization would
// also bypass OneQuery's server-side credential boundary for every other path.
const HERMES_ALLOWED_REQUEST_HEADERS = [
  "Accept",
  "Content-Type",
  "Idempotency-Key",
  "X-Hermes-Session-Id",
  "X-Hermes-Session-Key",
] as const;
const HERMES_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "location",
  "retry-after",
  "x-hermes-completed",
  "x-hermes-error",
  "x-hermes-partial",
  "x-hermes-session-id",
  "x-hermes-session-key",
] as const;

export const hermesSourceApiAdapter =
  createSimpleRestSourceApiAdapter<HermesCredentials>({
    allowedMethods: ["DELETE", "GET", "PATCH", "POST"],
    allowedRequestHeaders: HERMES_ALLOWED_REQUEST_HEADERS,
    allowedResponseHeaders: HERMES_ALLOWED_RESPONSE_HEADERS,
    apiBaseUrl: (credentials) => credentials.apiBaseUrl,
    auth: (credentials) => ({
      token: credentials.apiKey,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /v1/models --json`,
        description: "List models exposed by the Hermes Agent API server.",
        label: "List models",
      },
      {
        command: `onequery api --source ${sourceKey} /v1/responses --method POST --input '{"model":"hermes-agent","input":"Inspect the production API"}' --json`,
        description: "Create an OpenAI-compatible Hermes response.",
        label: "Create response",
      },
      {
        command: `onequery api --source ${sourceKey} /v1/runs --method POST --input '{"input":"Investigate the production API failures"}' --json`,
        description: "Start a native Hermes run.",
        label: "Start run",
      },
      {
        command: `onequery api --source ${sourceKey} /api/sessions --json`,
        description: "List persisted Hermes sessions.",
        label: "List sessions",
      },
    ],
    descriptorVersion: HERMES_DESCRIPTOR_VERSION,
    notes: [
      "Hermes API paths and JSON bodies pass through without a custom task abstraction.",
      "The Hermes API key stays server-side and is sent as Bearer authentication.",
      "Supported native surfaces include health, capabilities, models, skills, toolsets, chat completions, responses, runs, sessions, and jobs.",
      "The Chronos-only `/api/cron/fire` webhook uses a separate NAS-minted JWT and is not callable with Hermes API_SERVER_KEY credentials.",
    ],
    operationNotes: [
      "Use the native Hermes path as the selector and set the endpoint's actual HTTP method.",
      "Use `params` in the field patch for query string values and `timeoutMs` for the local request timeout.",
      "SSE endpoints such as `/v1/runs/{run_id}/events` and session chat streams are buffered by Source API and returned as text after the upstream stream closes.",
    ],
    provider: "hermes",
    providerLabel: "Hermes Agent",
  });
