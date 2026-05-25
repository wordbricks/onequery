import type { JiraCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const JIRA_DESCRIPTOR_VERSION = "jira.v1";

export const jiraSourceApiAdapter =
  createSimpleRestSourceApiAdapter<JiraCredentials>({
    apiBaseUrl: (credentials) => `${credentials.siteUrl}/rest/api/3`,
    auth: (credentials) => ({
      password: credentials.apiToken,
      type: "basic",
      username: credentials.email,
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /search/jql -f 'params[jql]=project IS NOT EMPTY ORDER BY updated DESC' -f params[maxResults]=25`,
        description: "Search Jira issues with JQL.",
        label: "Search issues",
      },
      {
        command: `onequery api --source ${sourceKey} /project/search -f params[maxResults]=25`,
        description: "List Jira projects visible to the API token.",
        label: "List projects",
      },
    ],
    descriptorVersion: JIRA_DESCRIPTOR_VERSION,
    notes: ["This adapter targets Jira Cloud REST API v3 under `/rest/api/3`."],
    provider: "jira",
    providerLabel: "Jira",
  });
