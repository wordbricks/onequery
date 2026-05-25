import type { SendGridCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const SENDGRID_DEFAULT_API_BASE_URL = "https://api.sendgrid.com/v3";
const SENDGRID_DESCRIPTOR_VERSION = "sendgrid.v1";

export const sendGridSourceApiAdapter =
  createSimpleRestSourceApiAdapter<SendGridCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? SENDGRID_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.apiKey,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /templates`,
        description: "List SendGrid dynamic templates visible to the API key.",
        label: "List templates",
      },
      {
        command: `onequery api --source ${sourceKey} /marketing/contacts -f params[page_size]=50`,
        description: "List SendGrid marketing contacts.",
        label: "List marketing contacts",
      },
    ],
    descriptorVersion: SENDGRID_DESCRIPTOR_VERSION,
    notes: [
      "SendGrid v3 API keys are sent as Authorization bearer tokens.",
      "Choose API key scopes that match the SendGrid endpoints OneQuery will call.",
    ],
    provider: "sendgrid",
    providerLabel: "SendGrid",
  });
