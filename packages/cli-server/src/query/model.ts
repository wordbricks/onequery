import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { CliQueryPlanResult } from "../domain/workflows";
import { createCliProblem } from "../error";
import { sourceNotFoundProblem } from "../source/model";
import type { CliQueryExecutionWorkflowResult } from "./workflow";

function sourceNotQueryableProblem(input: {
  sourceName: string;
  provider: ProviderType;
  status: DataSourceStatus;
}) {
  const detail =
    input.status !== "active"
      ? `source "${input.sourceName}" is "${input.status}" and cannot be queried`
      : `source "${input.sourceName}" uses provider "${input.provider}", which is visible in OneQuery but does not support SQL query execution in v1`;

  return createCliProblem({
    detail,
    key: "SOURCE_NOT_QUERYABLE",
  });
}

function queryRejectedProblem(detail: string) {
  return createCliProblem({
    detail,
    key: "QUERY_REJECTED",
  });
}

function queryFailedProblem(input: {
  key?:
    | "QUERY_PREPARATION_FAILED"
    | "QUERY_EXECUTION_FAILED"
    | "QUERY_EXECUTION_UNAVAILABLE"
    | "QUERY_EXECUTION_TIMED_OUT";
  detail: string;
  hint?: string;
}) {
  return createCliProblem({
    detail: input.detail,
    hint: input.hint,
    key: input.key ?? "QUERY_EXECUTION_FAILED",
  });
}

export function throwForCliQueryWorkflowResult(
  result: Exclude<CliQueryExecutionWorkflowResult, { kind: "response_ready" }>
): never {
  switch (result.kind) {
    case "source_not_found": {
      throw sourceNotFoundProblem(result.orgSlug, result.sourceName);
    }
    case "source_not_queryable": {
      throw sourceNotQueryableProblem({
        sourceName: result.sourceName,
        provider: result.provider,
        status: result.status,
      });
    }
    case "query_rejected": {
      throw queryRejectedProblem(result.detail);
    }
    case "query_preparation_failed": {
      throw queryFailedProblem({
        key: "QUERY_PREPARATION_FAILED",
        detail: result.detail,
        hint: result.hint,
      });
    }
    case "query_unavailable": {
      throw queryFailedProblem({
        key: "QUERY_EXECUTION_UNAVAILABLE",
        detail: result.detail,
      });
    }
    case "query_timed_out": {
      throw queryFailedProblem({
        key: "QUERY_EXECUTION_TIMED_OUT",
        detail: result.detail,
      });
    }
    case "query_execution_failed": {
      throw queryFailedProblem({
        key: "QUERY_EXECUTION_FAILED",
        detail: result.detail,
      });
    }
  }
}

export function throwForCliQueryPlanResult(
  result: Exclude<CliQueryPlanResult, { kind: "ready" }>
): never {
  switch (result.kind) {
    case "source_not_found": {
      throw sourceNotFoundProblem(result.orgSlug, result.sourceName);
    }
    case "source_not_queryable": {
      throw sourceNotQueryableProblem({
        sourceName: result.sourceName,
        provider: result.provider,
        status: result.status,
      });
    }
    case "query_rejected": {
      throw queryRejectedProblem(result.detail);
    }
    case "query_preparation_failed": {
      throw queryFailedProblem({
        key: "QUERY_PREPARATION_FAILED",
        detail: result.detail,
        hint: result.hint,
      });
    }
  }
}
