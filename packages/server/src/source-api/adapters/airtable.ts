import { isRecord } from "@onequery/base";
import type { AirtableCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const AIRTABLE_DEFAULT_API_BASE_URL = "https://api.airtable.com/v0";
const AIRTABLE_DESCRIPTOR_VERSION = "airtable.v1";

export const airtableSourceApiAdapter =
  createSimpleRestSourceApiAdapter<AirtableCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? AIRTABLE_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.personalAccessToken,
      type: "bearer",
    }),
    buildEndpoint: ({ credentials, selector }) =>
      buildAirtableEndpoint({ baseId: credentials.baseId, selector }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /TableName -f params[pageSize]=100`,
        description:
          "List records from the connected Airtable base using the default base ID.",
        label: "List records",
      },
      {
        command: `onequery api --source ${sourceKey} /meta/bases`,
        description: "List Airtable bases visible to the token.",
        label: "List bases",
      },
    ],
    descriptorVersion: AIRTABLE_DESCRIPTOR_VERSION,
    notes: [
      "Airtable list-records responses may include an `offset`; OneQuery exposes it as a continuation token.",
    ],
    operationNotes: [
      "When `baseId` is configured, selectors like `/TableName` expand to `/<baseId>/TableName`.",
      "Use `/meta/...` selectors for Airtable metadata endpoints.",
    ],
    paginationPolicy: "continuation_token",
    provider: "airtable",
    providerLabel: "Airtable",
    readNextContinuationState: (body) => {
      if (body.kind !== "json" || !isRecord(body.value)) {
        return undefined;
      }
      const offset = body.value.offset;
      if (typeof offset !== "string" || offset.length === 0) {
        return undefined;
      }
      return { params: { offset } };
    },
  });

function buildAirtableEndpoint(input: {
  baseId: string | undefined;
  selector: string;
}): string {
  if (!input.baseId) {
    return input.selector;
  }
  if (input.selector.startsWith("/meta/")) {
    return input.selector;
  }
  if (/^\/app[A-Za-z0-9]+(?:\/|$)/.test(input.selector)) {
    return input.selector;
  }
  return `/${encodeURIComponent(input.baseId)}${input.selector}`;
}
