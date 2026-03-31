import type { SentryCredentials } from "@onequery/db/server";

import { fetchSentryApi, listSentryProjects } from "../sentry/relay";
import { createHttpTester } from "./create-http-tester";
import { parseHttpStatusError } from "./parse-http-error";

export async function testSentryConnection(
  credentials: SentryCredentials,
  timeoutSeconds?: number
) {
  return createHttpTester<SentryCredentials>({
    parseError: (error, latencyMs, resolvedTimeoutSeconds) =>
      parseHttpStatusError(error, latencyMs, resolvedTimeoutSeconds, {
        accessDeniedError:
          "Auth token does not have the required Sentry permissions",
        authenticationError: "Invalid auth token",
        notFoundError: credentials.projectSlug
          ? "Project slug not found or not accessible"
          : "Organization slug not found or not accessible",
        notFoundMessage: credentials.projectSlug
          ? "Invalid Project Slug"
          : "Invalid Organization Slug",
      }),
    probe: (resolvedCredentials, timeoutMs) =>
      resolvedCredentials.projectSlug
        ? fetchSentryApi({
            credentials: resolvedCredentials,
            endpoint: "/projects/{organizationSlug}/{projectSlug}/events/",
            options: {
              method: "GET",
              params: {
                full: false,
                statsPeriod: "24h",
              },
              timeoutMs,
            },
          })
        : listSentryProjects({
            credentials: resolvedCredentials,
            options: {
              method: "GET",
              timeoutMs,
            },
          }),
  })(credentials, timeoutSeconds);
}
