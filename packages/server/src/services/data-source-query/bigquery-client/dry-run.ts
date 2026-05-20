import { parseJobsInsertResponse } from "./schemas";
import { createRequestId, requestBigQueryJson } from "./transport";
import type { BigQueryQueryRequest, BigQueryRunnerContext } from "./types";

export async function runBigQueryDryRun(
  input: BigQueryRunnerContext & BigQueryQueryRequest
): Promise<string | null> {
  const response = await requestBigQueryJson({
    accessTokenPromise: input.accessTokenPromise,
    body: {
      configuration: {
        dryRun: true,
        jobTimeoutMs: String(input.timeoutMs),
        query: {
          query: input.query,
          useLegacySql: false,
        },
      },
      jobReference: {
        projectId: input.projectId,
        jobId: createRequestId(),
        ...(input.location ? { location: input.location } : {}),
      },
    },
    method: "POST",
    path: "/jobs",
    projectId: input.projectId,
    timeoutMs: input.timeoutMs,
  });

  const dryRun = parseJobsInsertResponse(response);
  const totalBytesProcessed = dryRun.statistics?.query?.totalBytesProcessed;
  return typeof totalBytesProcessed === "string" ? totalBytesProcessed : null;
}
