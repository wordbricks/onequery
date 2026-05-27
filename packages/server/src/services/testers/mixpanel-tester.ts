import type { MixpanelCredentials } from "@onequery/db/server";
import {
  createFailedConnectionTest,
  createSuccessfulConnectionTest,
} from "@onequery/query/connection-test";
import { Result } from "better-result";

import {
  DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE,
  fetchMixpanelQueryApi,
} from "../mixpanel/relay";
import { createHttpTester } from "./create-http-tester";
import { parseHttpStatusError } from "./parse-http-error";

const MIXPANEL_ERROR_PATTERN = /^Mixpanel API error \((\d{3})\):\s*([\s\S]*)$/u;

function parseMixpanelError(
  error: Error,
  latencyMs: number,
  timeoutSeconds: number
) {
  const matched = MIXPANEL_ERROR_PATTERN.exec(error.message);
  if (matched && matched[1] === "400") {
    const detail = matched[2]?.trim().toLowerCase() ?? "";
    if (
      detail.includes("invalid project") ||
      detail.includes("project not found")
    ) {
      return Result.err(
        createFailedConnectionTest({
          detail: "Project ID not found or not accessible",
          latencyMs,
          message: "Invalid Project ID",
        })
      );
    }

    return Result.ok(createSuccessfulConnectionTest(latencyMs));
  }

  return Result.err(
    parseHttpStatusError(error, latencyMs, timeoutSeconds, {
      accessDeniedError: "Service Account does not have access to this project",
      authenticationError: "Invalid Service Account credentials",
    })
  );
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
