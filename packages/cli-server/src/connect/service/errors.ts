import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { CliQueryPlanResult } from "../../domain/workflows";
import type { CliQueryExecutionWorkflowResult } from "../../query/workflow";
import { throwCliConnectError } from "../error";

export function throwCliConnectSourceNotFound(
  orgSlug: string,
  sourceKey: string
): never {
  throwCliConnectError({
    detail: `no source named "${sourceKey}" exists in org "${orgSlug}"`,
    key: "SOURCE_NOT_FOUND",
  });
}

export function throwCliConnectSourceNameConflict(
  orgSlug: string,
  sourceName: string
): never {
  throwCliConnectError({
    detail: `source "${sourceName}" already exists in org "${orgSlug}"`,
    key: "SOURCE_NAME_CONFLICT",
  });
}

export function throwForCliConnectQueryWorkflowResult(
  result: Exclude<CliQueryExecutionWorkflowResult, { kind: "response_ready" }>
): never {
  switch (result.kind) {
    case "source_not_found":
      return throwCliConnectSourceNotFound(result.orgSlug, result.sourceName);
    case "source_not_queryable":
      return throwCliConnectSourceNotQueryable({
        provider: result.provider,
        sourceName: result.sourceName,
        status: result.status,
      });
    case "query_rejected":
      return throwCliConnectQueryRejected(result.detail);
    case "query_preparation_failed":
      return throwCliConnectQueryFailure({
        detail: result.detail,
        hint: result.hint,
        key: "QUERY_PREPARATION_FAILED",
      });
    case "query_unavailable":
      return throwCliConnectQueryFailure({
        detail: result.detail,
        key: "QUERY_EXECUTION_UNAVAILABLE",
      });
    case "query_timed_out":
      return throwCliConnectQueryFailure({
        detail: result.detail,
        key: "QUERY_EXECUTION_TIMED_OUT",
      });
    case "query_execution_failed":
      return throwCliConnectQueryFailure({
        detail: result.detail,
        key: "QUERY_EXECUTION_FAILED",
      });
  }
}

export function throwForCliConnectQueryPlanResult(
  result: Exclude<CliQueryPlanResult, { kind: "ready" }>
): never {
  switch (result.kind) {
    case "source_not_found":
      return throwCliConnectSourceNotFound(result.orgSlug, result.sourceName);
    case "source_not_queryable":
      return throwCliConnectSourceNotQueryable({
        provider: result.provider,
        sourceName: result.sourceName,
        status: result.status,
      });
    case "query_rejected":
      return throwCliConnectQueryRejected(result.detail);
    case "query_preparation_failed":
      return throwCliConnectQueryFailure({
        detail: result.detail,
        hint: result.hint,
        key: "QUERY_PREPARATION_FAILED",
      });
  }
}

function throwCliConnectSourceNotQueryable(input: {
  sourceName: string;
  provider: ProviderType;
  status: DataSourceStatus;
}): never {
  const detail =
    input.status !== "active"
      ? `source "${input.sourceName}" is "${input.status}" and cannot be queried`
      : `source "${input.sourceName}" uses provider "${input.provider}", which is visible in OneQuery but does not support SQL query execution in v1`;

  throwCliConnectError({
    detail,
    key: "SOURCE_NOT_QUERYABLE",
  });
}

function throwCliConnectQueryRejected(detail: string): never {
  throwCliConnectError({
    detail,
    key: "QUERY_REJECTED",
  });
}

function throwCliConnectQueryFailure(input: {
  key:
    | "QUERY_PREPARATION_FAILED"
    | "QUERY_EXECUTION_FAILED"
    | "QUERY_EXECUTION_UNAVAILABLE"
    | "QUERY_EXECUTION_TIMED_OUT";
  detail: string;
  hint?: string;
}): never {
  throwCliConnectError({
    detail: input.detail,
    hint: input.hint,
    key: input.key,
  });
}
