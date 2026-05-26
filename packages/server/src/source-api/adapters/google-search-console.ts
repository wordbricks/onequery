import type { GoogleSearchConsoleCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const GOOGLE_SEARCH_CONSOLE_DEFAULT_API_BASE_URL =
  "https://www.googleapis.com/webmasters/v3";
const GOOGLE_SEARCH_CONSOLE_DESCRIPTOR_VERSION = "google-search-console.v1";

export const googleSearchConsoleSourceApiAdapter =
  createSimpleRestSourceApiAdapter<GoogleSearchConsoleCredentials>({
    allowedMethods: ["GET", "POST", "PUT", "DELETE"],
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? GOOGLE_SEARCH_CONSOLE_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.accessToken,
      type: "bearer",
    }),
    buildEndpoint: ({ credentials, selector }) =>
      buildGoogleSearchConsoleEndpoint({
        selector,
        siteUrl: credentials.siteUrl,
      }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /searchAnalytics/query --method POST --input '{"startDate":"2026-05-01","endDate":"2026-05-07","dimensions":["query","page"],"rowLimit":1000}'`,
        description:
          "Query Search Console performance data for the default site URL.",
        label: "Query search analytics",
      },
      {
        command: `onequery api --source ${sourceKey} /sites`,
        description: "List Search Console sites visible to the token.",
        label: "List sites",
      },
    ],
    descriptorVersion: GOOGLE_SEARCH_CONSOLE_DESCRIPTOR_VERSION,
    notes: [
      "Search Console private data requires OAuth 2.0 authorization with the webmasters readonly or webmasters scope.",
    ],
    operationNotes: [
      "When `siteUrl` is configured, selector `/searchAnalytics/query` expands to `/sites/<encoded siteUrl>/searchAnalytics/query`.",
      "Use explicit `/sites/...` selectors when overriding the connected site URL.",
    ],
    provider: "google_search_console",
    providerLabel: "Google Search Console",
  });

function buildGoogleSearchConsoleEndpoint(input: {
  selector: string;
  siteUrl: string | undefined;
}): string {
  if (!input.siteUrl || input.selector !== "/searchAnalytics/query") {
    return input.selector;
  }
  return `/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`;
}
