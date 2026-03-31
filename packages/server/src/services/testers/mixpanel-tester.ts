import type { MixpanelCredentials } from "@onequery/db/server";

import {
  DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE,
  fetchMixpanelQueryApi,
} from "../mixpanel/relay";
import { createHttpTester } from "./create-http-tester";
import { parseHttpStatusError } from "./parse-http-error";
import type { ConnectionTestResult } from "./postgres-tester";

const MIXPANEL_ERROR_PATTERN = /^Mixpanel API error \((\d{3})\):\s*([\s\S]*)$/u;

function parseMixpanelError(
  error: Error,
  latencyMs: number,
  timeoutSeconds: number
): ConnectionTestResult {
  const matched = error.message.match(MIXPANEL_ERROR_PATTERN);
  if (matched && matched[1] === "400") {
    const detail = matched[2]?.trim().toLowerCase() ?? "";
    if (
      detail.includes("invalid project") ||
      detail.includes("project not found")
    ) {
      return {
        error: "Project ID not found or not accessible",
        latencyMs,
        message: "Invalid Project ID",
        success: false,
      };
    }

    return {
      latencyMs,
      message: `Connection successful (${latencyMs}ms)`,
      success: true,
    };
  }

  return parseHttpStatusError(error, latencyMs, timeoutSeconds, {
    accessDeniedError: "Service Account does not have access to this project",
    authenticationError: "Invalid Service Account credentials",
  });
}

export const testMixpanelConnection = createHttpTester<MixpanelCredentials>({
  parseError: parseMixpanelError,
  probe: (credentials, timeoutMs) =>
    fetchMixpanelQueryApi({
      credentials,
      endpoint: "/query/engage",
      options: {
        body: {
          filter_by_cohort: {},
          page: 0,
          page_size: DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE,
        },
        bodyFormat: "form",
        method: "POST",
        timeoutMs,
      },
    }),
});
