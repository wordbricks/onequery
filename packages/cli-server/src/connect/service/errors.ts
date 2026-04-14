import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { CliQueryPlanResult } from "../../domain/workflows";
import type { CliQueryExecutionWorkflowResult } from "../../query/workflow";
import { createCliConnectProblem } from "../error";

export function createCliConnectSourceNotFoundProblem(
  orgSlug: string,
  sourceKey: string
) {
  return createCliConnectProblem({
    detail: `no source named "${sourceKey}" exists in org "${orgSlug}"`,
    key: "SOURCE_NOT_FOUND",
  });
}

export function createCliConnectSourceNameConflictProblem(
  orgSlug: string,
  sourceName: string
) {
  return createCliConnectProblem({
    detail: `source "${sourceName}" already exists in org "${orgSlug}"`,
    key: "SOURCE_NAME_CONFLICT",
  });
}

export function createCliConnectProblemForQueryWorkflowResult(
  result: Exclude<CliQueryExecutionWorkflowResult, { kind: "response_ready" }>
) {
  switch (result.kind) {
    case "source_not_found":
      return createCliConnectSourceNotFoundProblem(
        result.orgSlug,
        result.sourceName
      );
    case "source_not_queryable":
      return createCliConnectSourceNotQueryableProblem({
        provider: result.provider,
        sourceName: result.sourceName,
        status: result.status,
      });
    case "query_rejected":
      return createCliConnectQueryRejectedProblem(result.detail);
    case "query_preparation_failed":
      return createCliConnectQueryFailureProblem({
        detail: result.detail,
        key: "QUERY_PREPARATION_FAILED",
      });
    case "query_unavailable":
      return createCliConnectQueryFailureProblem({
        detail: result.detail,
        key: "QUERY_EXECUTION_UNAVAILABLE",
      });
    case "query_timed_out":
      return createCliConnectQueryFailureProblem({
        detail: result.detail,
        key: "QUERY_EXECUTION_TIMED_OUT",
      });
    case "query_execution_failed":
      return createCliConnectQueryFailureProblem({
        detail: result.detail,
        key: "QUERY_EXECUTION_FAILED",
      });
  }
}

export function createCliConnectProblemForQueryPlanResult(
  result: Exclude<CliQueryPlanResult, { kind: "ready" }>
) {
  switch (result.kind) {
    case "source_not_found":
      return createCliConnectSourceNotFoundProblem(
        result.orgSlug,
        result.sourceName
      );
    case "source_not_queryable":
      return createCliConnectSourceNotQueryableProblem({
        provider: result.provider,
        sourceName: result.sourceName,
        status: result.status,
      });
    case "query_rejected":
      return createCliConnectQueryRejectedProblem(result.detail);
    case "query_preparation_failed":
      return createCliConnectQueryFailureProblem({
        detail: result.detail,
        key: "QUERY_PREPARATION_FAILED",
      });
  }
}

function createCliConnectSourceNotQueryableProblem(input: {
  sourceName: string;
  provider: ProviderType;
  status: DataSourceStatus;
}) {
  const detail =
    input.status !== "active"
      ? `source "${input.sourceName}" is "${input.status}" and cannot be queried`
      : `source "${input.sourceName}" uses provider "${input.provider}", which is visible in OneQuery but does not support SQL query execution in v1`;

  return createCliConnectProblem({
    detail,
    key: "SOURCE_NOT_QUERYABLE",
  });
}

function createCliConnectQueryRejectedProblem(detail: string) {
  return createCliConnectProblem({
    detail,
    key: "QUERY_REJECTED",
  });
}

function createCliConnectQueryFailureProblem(input: {
  key:
    | "QUERY_PREPARATION_FAILED"
    | "QUERY_EXECUTION_FAILED"
    | "QUERY_EXECUTION_UNAVAILABLE"
    | "QUERY_EXECUTION_TIMED_OUT";
  detail: string;
}) {
  return createCliConnectProblem({
    detail: input.detail,
    key: input.key,
  });
}
