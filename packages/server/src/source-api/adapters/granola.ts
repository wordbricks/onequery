import { isRecord } from "@onequery/base";
import type { GranolaCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const GRANOLA_DEFAULT_API_BASE_URL = "https://public-api.granola.ai/v1";
const GRANOLA_DESCRIPTOR_VERSION = "granola.v1";

export const granolaSourceApiAdapter =
  createSimpleRestSourceApiAdapter<GranolaCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? GRANOLA_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.apiKey,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /notes -f params[created_after]=2026-05-01T00:00:00Z`,
        description: "List Granola notes visible to the API key.",
        label: "List notes",
      },
      {
        command: `onequery api --source ${sourceKey} /notes/not_1d3tmYTlCICgjy -f params[include]=transcript`,
        description: "Fetch one note and include its transcript.",
        label: "Get note transcript",
      },
    ],
    descriptorVersion: GRANOLA_DESCRIPTOR_VERSION,
    notes: [
      "Granola only returns notes that have generated summaries and transcripts.",
    ],
    paginationPolicy: "continuation_token",
    provider: "granola",
    providerLabel: "Granola",
    readNextContinuationState: (body) => {
      if (body.kind !== "json" || !isRecord(body.value)) {
        return undefined;
      }
      if (body.value.hasMore !== true) {
        return undefined;
      }
      const cursor = body.value.cursor;
      if (typeof cursor !== "string" || cursor.length === 0) {
        return undefined;
      }
      return { params: { cursor } };
    },
  });
