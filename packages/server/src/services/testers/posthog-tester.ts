import type { PostHogCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { runPostHogQuery } from "../posthog/relay";
import { createHttpTester } from "./create-http-tester";
import { parseHttpStatusError } from "./parse-http-error";

export const testPostHogConnection = createHttpTester<PostHogCredentials>({
  parseError: (error, latencyMs, timeoutSeconds) =>
    Result.err(
      parseHttpStatusError(error, latencyMs, timeoutSeconds, {
        accessDeniedError:
          "Personal API Key does not have access to this project",
        authenticationError: "Invalid Personal API Key",
        notFoundError: "Project ID not found or Host URL is incorrect",
        notFoundMessage: "Invalid Project ID",
      })
    ),
  probe: (credentials, timeoutMs) =>
    runPostHogQuery({
      credentials,
      query: { kind: "HogQLQuery", query: "SELECT 1" },
      refresh: "blocking",
      timeoutMs,
    }),
});
