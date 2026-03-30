import type { ProviderType } from "@onequery/db/server";
import type { z } from "zod";

import type {
  CliQueryExecuteResponse,
  CliQueryValidateResponse,
} from "../../generated/cli.zod";
import type { AuthorizedCliOrgContext } from "../authorization";
import type {
  CliQuerySuccessResult,
  CliSessionIdentity,
} from "../domain/workflows";
import { throwCliProblem } from "../error";
import {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
  toCliErrorMessage,
} from "../observability";
import type {
  CliFieldsReadControls,
  CliPaginatedReadControls,
} from "../read-controls";
import { projectCliSourceSummary } from "../transport/source-response";
import type { CliQueryActionTrailActor } from "./logging";
import type {
  CliQueryExecutionWorkflowResult,
  CliQueryValidationWorkflowResult,
} from "./workflow";

type QueryValidateResponse = z.infer<typeof CliQueryValidateResponse>;
type QueryValidateData = QueryValidateResponse["data"];
type QueryValidateRequest = NonNullable<QueryValidateData["request"]>;
type QueryValidateResultWindow = NonNullable<
  QueryValidateData["declaredResultWindow"]
>;
type QueryValidateSource = NonNullable<QueryValidateData["source"]>;

type QueryExecuteResponse = z.infer<typeof CliQueryExecuteResponse>;
type QueryExecuteData = QueryExecuteResponse["data"];
type QueryExecuteSource = NonNullable<QueryExecuteData["source"]>;
type QueryExecuteResponseColumn = NonNullable<
  QueryExecuteData["columns"]
>[number];

type CliQueryValidationFailure = Exclude<
  CliQueryValidationWorkflowResult,
  { kind: "ready" }
>;

type CliQueryExecutionFailure = Exclude<
  CliQueryExecutionWorkflowResult,
  { kind: "response_ready" }
>;

export function buildCliQueryActionTrailActor(input: {
  authorizedOrg: Pick<AuthorizedCliOrgContext, "membershipRoles">;
  session: Pick<CliSessionIdentity, "authMode" | "user">;
}): CliQueryActionTrailActor {
  return {
    authMode: input.session.authMode,
    email: input.session.user.email,
    membershipRoles: [...input.authorizedOrg.membershipRoles],
    userId: input.session.user.id,
  };
}

export function logCliQueryActionTrailFailure(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  actionType: "execute" | "validate";
  operation: "create" | "append";
  eventType?: string;
  error: unknown;
}) {
  recordCliCounterMetric({
    name: "cli.query.action_trail_failure_total",
    tags: {
      actionType: input.actionType,
      eventType: input.eventType ?? null,
      operation: input.operation,
    },
  });
  logCliEvent({
    level: "warn",
    event: "query.action_trail.persistence_failed",
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      queryActionType: input.actionType,
      trailOperation: input.operation,
      eventType: input.eventType ?? null,
      error: toCliErrorMessage(input.error),
    }),
  });
}

export function throwCliQueryActionTrailFailure(input: {
  actionType: "execute" | "validate";
  operation: "create" | "append";
  sourceKey: string;
  eventType?: string;
}): never {
  const detail =
    input.operation === "create"
      ? `query action trail could not be created for ${input.actionType} on source "${input.sourceKey}"`
      : `query action trail could not append ${input.eventType ?? "workflow"} for ${input.actionType} on source "${input.sourceKey}"`;

  throwCliProblem({
    detail,
    hint: "retry the CLI query request when the query action trail store is healthy",
    key: "QUERY_PREPARATION_FAILED",
  });
}

export function buildQueryValidateResponse(
  response: {
    request: QueryValidateRequest;
    normalizedSql: string;
    declaredResultWindow: QueryValidateResultWindow;
    source: QueryValidateSource;
    truncated: boolean;
  },
  selectedFields: CliFieldsReadControls["selectedFields"]
): QueryValidateData {
  if (!selectedFields) {
    return response;
  }

  const projected: QueryValidateData = {};

  if (selectedFields.has("request")) {
    projected.request = response.request;
  } else if (
    selectedFields.has("request.sql") ||
    selectedFields.has("request.parameters") ||
    selectedFields.has("request.maxRows") ||
    selectedFields.has("request.maxBytes") ||
    selectedFields.has("request.cellMaxChars") ||
    selectedFields.has("request.timeoutMs")
  ) {
    projected.request = {};
    if (selectedFields.has("request.sql")) {
      projected.request.sql = response.request.sql;
    }
    if (selectedFields.has("request.parameters")) {
      projected.request.parameters = response.request.parameters;
    }
    if (selectedFields.has("request.maxRows")) {
      projected.request.maxRows = response.request.maxRows;
    }
    if (selectedFields.has("request.maxBytes")) {
      projected.request.maxBytes = response.request.maxBytes;
    }
    if (selectedFields.has("request.cellMaxChars")) {
      projected.request.cellMaxChars = response.request.cellMaxChars;
    }
    if (selectedFields.has("request.timeoutMs")) {
      projected.request.timeoutMs = response.request.timeoutMs;
    }
  }

  if (selectedFields.has("normalizedSql")) {
    projected.normalizedSql = response.normalizedSql;
  }

  if (selectedFields.has("declaredResultWindow")) {
    projected.declaredResultWindow = response.declaredResultWindow;
  } else if (
    selectedFields.has("declaredResultWindow.maxRows") ||
    selectedFields.has("declaredResultWindow.maxBytes") ||
    selectedFields.has("declaredResultWindow.cellMaxChars") ||
    selectedFields.has("declaredResultWindow.timeoutMs")
  ) {
    projected.declaredResultWindow = {};
    if (selectedFields.has("declaredResultWindow.maxRows")) {
      projected.declaredResultWindow.maxRows =
        response.declaredResultWindow.maxRows;
    }
    if (selectedFields.has("declaredResultWindow.maxBytes")) {
      projected.declaredResultWindow.maxBytes =
        response.declaredResultWindow.maxBytes;
    }
    if (selectedFields.has("declaredResultWindow.cellMaxChars")) {
      projected.declaredResultWindow.cellMaxChars =
        response.declaredResultWindow.cellMaxChars;
    }
    if (selectedFields.has("declaredResultWindow.timeoutMs")) {
      projected.declaredResultWindow.timeoutMs =
        response.declaredResultWindow.timeoutMs;
    }
  }

  const projectedSource = projectCliSourceSummary(
    response.source,
    selectedFields,
    "source"
  );
  if (Object.keys(projectedSource).length > 0) {
    projected.source = projectedSource;
  }

  if (selectedFields.has("truncated")) {
    projected.truncated = response.truncated;
  }

  return projected;
}

export function logCliQueryValidationFailure(
  c: Parameters<typeof buildCliRequestLogDetails>[0],
  sourceKey: string,
  result: CliQueryValidationFailure
) {
  switch (result.kind) {
    case "source_not_found": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_found",
        details: buildCliRequestLogDetails(c, {
          orgSlug: result.orgSlug,
          source: sourceKey,
          httpStatus: 404,
        }),
      });
      return;
    }
    case "source_not_queryable": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_queryable",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          provider: result.provider,
          sourceStatus: result.status,
          httpStatus: 400,
        }),
      });
      return;
    }
    case "query_rejected": {
      logCliEvent({
        level: "warn",
        event: "query.plan.rejected",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          detail: result.detail,
          httpStatus: 400,
        }),
      });
      return;
    }
    case "query_preparation_failed": {
      logCliEvent({
        level: "warn",
        event: "query.plan.preparation_failed",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          detail: result.detail,
          hint: result.hint ?? null,
          httpStatus: 500,
        }),
      });
    }
  }
}

export function logCliQueryValidationAccepted(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  provider: ProviderType;
  truncated: boolean;
}) {
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.provider,
      truncated: input.truncated,
    }),
    event: "query.plan.accepted",
    level: "info",
  });
}

export function buildQueryExecuteResponse(
  response: {
    source: QueryExecuteSource;
    rowCount: NonNullable<QueryExecuteData["rowCount"]>;
    elapsedMs: NonNullable<QueryExecuteData["elapsedMs"]>;
    columns: readonly QueryExecuteResponseColumn[];
    rows: readonly (readonly string[])[];
    truncated: NonNullable<QueryExecuteData["truncated"]>;
  },
  selectedFields: CliPaginatedReadControls["selectedFields"]
): QueryExecuteData {
  const columns = response.columns.map((column) => ({ ...column }));
  const rows = response.rows.map((row) => [...row]);

  if (!selectedFields) {
    return {
      ...response,
      columns,
      rows,
    };
  }

  const projected: QueryExecuteData = {};

  const projectedSource = projectCliSourceSummary(
    response.source,
    selectedFields,
    "source"
  );
  if (Object.keys(projectedSource).length > 0) {
    projected.source = projectedSource;
  }

  if (selectedFields.has("rowCount")) {
    projected.rowCount = response.rowCount;
  }

  if (selectedFields.has("elapsedMs")) {
    projected.elapsedMs = response.elapsedMs;
  }

  if (selectedFields.has("columns")) {
    projected.columns = columns;
  } else if (
    selectedFields.has("columns.name") ||
    selectedFields.has("columns.logicalType")
  ) {
    projected.columns = columns.map((column) => {
      const projectedColumn: QueryExecuteResponseColumn = {};
      if (selectedFields.has("columns.name")) {
        projectedColumn.name = column.name;
      }
      if (selectedFields.has("columns.logicalType")) {
        projectedColumn.logicalType = column.logicalType ?? null;
      }
      return projectedColumn;
    });
  }

  if (selectedFields.has("rows")) {
    projected.rows = rows;
  }

  if (selectedFields.has("truncated")) {
    projected.truncated = response.truncated;
  }

  return projected;
}

export function logCliQueryExecutionFailure(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  result: CliQueryExecutionFailure;
  durationMs: number;
}) {
  const httpStatus = getCliQueryFailureHttpStatus(input.result);

  switch (input.result.kind) {
    case "source_not_found": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_found",
        details: buildCliRequestLogDetails(input.c, {
          orgSlug: input.result.orgSlug,
          source: input.sourceKey,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "source_not_queryable": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_queryable",
        details: buildCliRequestLogDetails(input.c, {
          source: input.result.sourceName,
          provider: input.result.provider,
          sourceStatus: input.result.status,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "query_rejected": {
      logCliEvent({
        level: "warn",
        event: "query.plan.rejected",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "query_preparation_failed": {
      logCliEvent({
        level: "warn",
        event: "query.plan.preparation_failed",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          hint: input.result.hint ?? null,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "query_unavailable": {
      recordCliCounterMetric({
        name: "cli.query.retryable_total",
        tags: {
          outcome: input.result.kind,
        },
      });
      logCliEvent({
        level: "warn",
        event: "query.execution.unavailable",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
          retryable: true,
        }),
      });
      return;
    }
    case "query_timed_out": {
      recordCliCounterMetric({
        name: "cli.query.timeout_total",
      });
      recordCliCounterMetric({
        name: "cli.query.retryable_total",
        tags: {
          outcome: input.result.kind,
        },
      });
      logCliEvent({
        level: "warn",
        event: "query.execution.timed_out",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
          retryable: true,
        }),
      });
      return;
    }
    case "query_execution_failed": {
      logCliEvent({
        level: "warn",
        event: "query.execution.failed",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
          retryable: false,
        }),
      });
    }
  }
}

export function logCliQueryExecutionSuccess(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  response: Pick<
    CliQuerySuccessResult,
    "source" | "rowCount" | "elapsedMs" | "truncated"
  >;
  durationMs: number;
  usagePersistence: CliQueryExecutionWorkflowResult extends infer TResult
    ? TResult extends { kind: "response_ready"; usagePersistence: infer TUsage }
      ? TUsage
      : never
    : never;
}) {
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.response.source.provider,
      truncated: input.response.truncated,
      durationMs: input.durationMs,
    }),
    event: "query.plan.accepted",
    level: "info",
  });
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.response.source.provider,
      rowCount: input.response.rowCount,
      queryElapsedMs: input.response.elapsedMs,
      durationMs: input.durationMs,
    }),
    event: "query.execution.succeeded",
    level: "info",
  });

  if (input.usagePersistence.kind === "usage_persist_failed") {
    logCliEvent({
      details: buildCliRequestLogDetails(input.c, {
        sourceId: input.usagePersistence.sourceId,
        detail: input.usagePersistence.detail,
      }),
      event: "query.usage_persist_failed",
      level: "warn",
    });
  }
}

function getCliQueryFailureHttpStatus(
  result: CliQueryExecutionFailure
): 400 | 404 | 500 | 503 | 504 {
  switch (result.kind) {
    case "source_not_queryable":
    case "query_rejected": {
      return 400;
    }
    case "source_not_found": {
      return 404;
    }
    case "query_preparation_failed":
    case "query_execution_failed": {
      return 500;
    }
    case "query_unavailable": {
      return 503;
    }
    case "query_timed_out": {
      return 504;
    }
  }
}

export function throwIfCliQueryParametersProvided(
  parameters: readonly unknown[] | undefined
): void {
  if ((parameters?.length ?? 0) === 0) {
    return;
  }

  // Comment: Part 6 reserves a structured `parameters` field, but the current
  // query engine still executes raw SQL strings only. Reject non-empty
  // parameters here so the CLI never silently drops caller intent.
  throwCliProblem({
    detail: "query parameters are not implemented for the CLI query API yet",
    hint: "inline literal values in SQL and retry",
    key: "INVALID_REQUEST",
    stage: "read_query_input",
  });
}
