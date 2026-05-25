import { isRecord } from "@onequery/base";
import type { CalCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const CAL_DEFAULT_API_BASE_URL = "https://api.cal.com/v2";
const CAL_DESCRIPTOR_VERSION = "cal.v1";

export const calSourceApiAdapter =
  createSimpleRestSourceApiAdapter<CalCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? CAL_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.apiKey,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /bookings -f params[status]=upcoming`,
        description: "List upcoming Cal.com bookings.",
        label: "List bookings",
      },
      {
        command: `onequery api --source ${sourceKey} /event-types`,
        description: "List event types visible to the token.",
        label: "List event types",
      },
    ],
    defaultHeaders: (credentials) => ({
      "cal-api-version": credentials.apiVersion,
    }),
    descriptorVersion: CAL_DESCRIPTOR_VERSION,
    notes: [
      "Cal.com API v2 requires the `cal-api-version` header; this adapter sends the version stored in source credentials.",
    ],
    paginationPolicy: "continuation_token",
    provider: "cal",
    providerLabel: "Cal.com",
    readNextContinuationState: (body) => {
      if (body.kind !== "json" || !isRecord(body.value)) {
        return undefined;
      }
      const pagination = body.value.pagination;
      if (!isRecord(pagination) || pagination.hasMore !== true) {
        return undefined;
      }
      const cursor = pagination.nextCursor;
      if (typeof cursor !== "string" || cursor.length === 0) {
        return undefined;
      }
      return { params: { cursor } };
    },
  });
