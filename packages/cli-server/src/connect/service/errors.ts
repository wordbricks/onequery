import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { CliQueryPlanResult } from "../../domain/workflows";
import type { CliQueryExecutionWorkflowResult } from "./query/workflow-result";
import { createCliServiceFailure } from "./result";

export function createCliSourceNotFoundFailure(
  orgSlug: string,
  sourceKey: string
) {
  return createCliServiceFailure({
    detail: `no source named "${sourceKey}" exists in org "${orgSlug}"`,
    key: "SOURCE_NOT_FOUND",
    resource: {
      description: "source was not found",
      name: sourceKey,
      owner: orgSlug,
      type: "onequery.cli.source",
    },
  });
}

export function createCliSourceNameConflictFailure(
  orgSlug: string,
  sourceName: string
) {
  return createCliServiceFailure({
    detail: `source "${sourceName}" already exists in org "${orgSlug}"`,
    key: "SOURCE_NAME_CONFLICT",
    resource: {
      description: "source name already exists",
      name: sourceName,
      owner: orgSlug,
      type: "onequery.cli.source",
    },
  });
}

export function createCliFailureForQueryWorkflowResult(
  result: Exclude<CliQueryExecutionWorkflowResult, { kind: "response_ready" }>
) {
  switch (result.kind) {
    case "source_not_found":
      return createCliSourceNotFoundFailure(result.orgSlug, result.sourceName);
    case "source_query_interface_missing":
      return createCliMissingQueryInterfaceFailure({
        provider: result.provider,
        sourceName: result.sourceName,
        status: result.status,
      });
    case "query_rejected":
      return createCliQueryRejectedFailure(result.detail);
    case "query_preparation_failed":
      return createCliQueryFailure({
        detail: result.detail,
        key: "QUERY_PREPARATION_FAILED",
      });
    case "query_unavailable":
      return createCliQueryFailure({
        detail: result.detail,
        key: "QUERY_EXECUTION_UNAVAILABLE",
      });
    case "query_timed_out":
      return createCliQueryFailure({
        detail: result.detail,
        key: "QUERY_EXECUTION_TIMED_OUT",
      });
    case "query_execution_failed":
      return createCliQueryFailure({
        detail: result.detail,
        key: "QUERY_EXECUTION_FAILED",
      });
  }
}

export function createCliFailureForQueryPlanResult(
  result: Exclude<CliQueryPlanResult, { kind: "ready" }>
) {
  switch (result.kind) {
    case "source_not_found":
      return createCliSourceNotFoundFailure(result.orgSlug, result.sourceName);
    case "source_query_interface_missing":
      return createCliMissingQueryInterfaceFailure({
        provider: result.provider,
        sourceName: result.sourceName,
        status: result.status,
      });
    case "query_rejected":
      return createCliQueryRejectedFailure(result.detail);
    case "query_preparation_failed":
      return createCliQueryFailure({
        detail: result.detail,
        key: "QUERY_PREPARATION_FAILED",
      });
  }
}

function createCliMissingQueryInterfaceFailure(input: {
  sourceName: string;
  provider: ProviderType;
  status: DataSourceStatus;
}) {
  const detail =
    input.status !== "active"
      ? `source "${input.sourceName}" is "${input.status}" and does not expose the query interface`
      : `source "${input.sourceName}" uses provider "${input.provider}", which is visible in OneQuery but does not expose the query interface`;

  return createCliServiceFailure({
    detail,
    key: "SOURCE_QUERY_INTERFACE_MISSING",
    resource: {
      description: detail,
      name: input.sourceName,
      type: "onequery.cli.source",
    },
  });
}

function createCliQueryRejectedFailure(detail: string) {
  return createCliServiceFailure({
    detail,
    key: "QUERY_REJECTED",
  });
}

function createCliQueryFailure(input: {
  key:
    | "QUERY_PREPARATION_FAILED"
    | "QUERY_EXECUTION_FAILED"
    | "QUERY_EXECUTION_UNAVAILABLE"
    | "QUERY_EXECUTION_TIMED_OUT";
  detail: string;
}) {
  return createCliServiceFailure({
    detail: input.detail,
    key: input.key,
  });
}
