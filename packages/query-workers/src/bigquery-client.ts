import type { BigQueryCredentials } from "@onequery/query";

import { listProjectDatasets } from "./bigquery-client/datasets-machine";
import { runBigQueryDryRun } from "./bigquery-client/dry-run";
import { runBigQueryQuery } from "./bigquery-client/query-machine";
import {
  normalizeBigQueryAccessToken,
  normalizeBigQueryProjectId,
} from "./bigquery-client/security";
import { BIGQUERY_SCOPE } from "./bigquery-client/types";
import type { BigQueryClient } from "./bigquery-client/types";
import { getServiceAccountAccessToken } from "./oauth/service-account-token";

export type { BigQueryClient } from "./bigquery-client/types";

export async function createBigQueryClient(
  credentials: BigQueryCredentials
): Promise<BigQueryClient> {
  const accessTokenPromise = resolveBigQueryAccessToken(credentials);
  const runnerContext = {
    accessTokenPromise,
    projectId: normalizeBigQueryProjectId(credentials.projectId),
  };

  return {
    listDatasets: async () => listProjectDatasets(runnerContext),
    runDryRun: async (input) =>
      runBigQueryDryRun({
        ...runnerContext,
        ...input,
      }),
    runQuery: async (input) =>
      runBigQueryQuery({
        ...runnerContext,
        ...input,
      }),
  };
}

export async function resolveBigQueryAccessToken(
  credentials: BigQueryCredentials
): Promise<string> {
  if (credentials.authType === "service_account") {
    return normalizeBigQueryAccessToken(
      await getServiceAccountAccessToken({
        clientEmail: credentials.serviceAccount.clientEmail,
        privateKey: credentials.serviceAccount.privateKey,
        scope: BIGQUERY_SCOPE,
      })
    );
  }

  return normalizeBigQueryAccessToken(credentials.accessToken);
}
