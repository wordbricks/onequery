import type { CloudflareWebAnalyticsCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const CLOUDFLARE_DEFAULT_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_WEB_ANALYTICS_DESCRIPTOR_VERSION =
  "cloudflare-web-analytics.v1";

export const cloudflareWebAnalyticsSourceApiAdapter =
  createSimpleRestSourceApiAdapter<CloudflareWebAnalyticsCredentials>({
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? CLOUDFLARE_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.apiToken,
      type: "bearer",
    }),
    buildEndpoint: ({ credentials, selector }) =>
      buildCloudflareWebAnalyticsEndpoint({ credentials, selector }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /graphql --method POST --input '{"query":"query WebAnalytics($accountTag: String, $siteTag: String) { viewer { accounts(filter: { accountTag: $accountTag }) { rumPageloadEventsAdaptiveGroups(limit: 10, filter: { siteTag: $siteTag }) { count } } } }","variables":{"accountTag":"<accountId>","siteTag":"<siteTag>"}}'`,
        description:
          "Run a Cloudflare Analytics GraphQL query for Web Analytics RUM data.",
        label: "Query RUM analytics",
      },
      {
        command: `onequery api --source ${sourceKey} /accounts/{accountId}/rum/v2`,
        description:
          "List Web Analytics site configuration visible to the connected Cloudflare account token.",
        label: "List Web Analytics sites",
      },
      {
        command: `onequery api --source ${sourceKey} /accounts/{accountId}/rum/v2/{siteTag}`,
        description:
          "Fetch one Web Analytics site configuration using the connected site tag.",
        label: "Get Web Analytics site",
      },
    ],
    defaultHeaders: () => ({
      "Content-Type": "application/json",
    }),
    descriptorVersion: CLOUDFLARE_WEB_ANALYTICS_DESCRIPTOR_VERSION,
    notes: [
      "Cloudflare Web Analytics data is queried through the Cloudflare Analytics GraphQL API.",
      "Web Analytics RUM site configuration uses the Cloudflare account RUM API.",
      "Workers Observability uses a separate Workers telemetry API; share the account ID and token when the token has both permission sets, but keep it as a separate source.",
    ],
    operationNotes: [
      "`{accountId}` in selectors expands to the connected Cloudflare account ID.",
      "`{siteTag}` in selectors expands to the optional connected Web Analytics site tag.",
      "Use selector `/graphql` with `--method POST` and a JSON GraphQL payload for analytics queries.",
    ],
    provider: "cloudflare_web_analytics",
    providerLabel: "Cloudflare Web Analytics",
  });

function buildCloudflareWebAnalyticsEndpoint(input: {
  credentials: CloudflareWebAnalyticsCredentials;
  selector: string;
}): string {
  return input.selector
    .replaceAll("{accountId}", encodeURIComponent(input.credentials.accountId))
    .replaceAll(
      "{siteTag}",
      encodeURIComponent(input.credentials.siteTag ?? "")
    );
}
