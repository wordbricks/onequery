import type { CodexAppServerApiCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const CODEX_APP_SERVER_API_DESCRIPTOR_VERSION = "codex-app-server-api.v1";
const CODEX_APP_SERVER_API_ALLOWED_REQUEST_HEADERS = [
  "Accept",
  "Content-Type",
  "Idempotency-Key",
  "OpenAI-Beta",
  "X-Workspace-Path",
] as const;
const CODEX_APP_SERVER_API_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "location",
  "openai-organization",
  "openai-processing-ms",
  "openai-version",
  "retry-after",
  "x-request-id",
] as const;

export const codexAppServerApiSourceApiAdapter =
  createSimpleRestSourceApiAdapter<CodexAppServerApiCredentials>({
    allowedMethods: ["GET", "POST"],
    allowedRequestHeaders: CODEX_APP_SERVER_API_ALLOWED_REQUEST_HEADERS,
    allowedResponseHeaders: CODEX_APP_SERVER_API_ALLOWED_RESPONSE_HEADERS,
    apiBaseUrl: (credentials) => credentials.apiBaseUrl,
    auth: (credentials) => ({
      token: credentials.apiKey,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /v1/models --json`,
        description: "List models exposed by the Codex App Server API.",
        label: "List models",
      },
      {
        command: `onequery api --source ${sourceKey} /v1/responses --method POST --input '{"model":"gpt-5.4","input":"Summarize this repository in five bullets."}' --json`,
        description: "Create an OpenAI-compatible Codex response.",
        label: "Create response",
      },
      {
        command: `onequery api --source ${sourceKey} /v1/chat/completions --method POST --input '{"model":"gpt-5.4","messages":[{"role":"user","content":"What changed in this repository?"}]}' --json`,
        description: "Create an OpenAI-compatible Codex chat completion.",
        label: "Create chat completion",
      },
    ],
    descriptorVersion: CODEX_APP_SERVER_API_DESCRIPTOR_VERSION,
    notes: [
      "Codex App Server API paths and JSON bodies pass through without a custom task abstraction.",
      "The API key stays server-side and is sent as Bearer authentication.",
      "Supported native surfaces include health, models, responses, and chat completions.",
    ],
    operationNotes: [
      "Use the native Codex App Server API path as the selector and set the endpoint's actual HTTP method.",
      "Use `params` in the field patch for query string values and `timeoutMs` for the local request timeout.",
      "Workspace selection can be passed in the JSON body or with the `X-Workspace-Path` header when the upstream API allows it.",
    ],
    provider: "codex_app_server_api",
    providerLabel: "Codex App Server API",
  });
