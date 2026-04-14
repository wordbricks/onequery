import type { MessageInitShape } from "@bufbuild/protobuf";
import type { ProviderType } from "@onequery/db/server";
import { Result } from "better-result";

import type { AuthorizedCliOrgContext } from "../../authorization";
import type { CliSessionIdentity } from "../../domain/workflows";
import {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
  recordCliHistogramMetric,
  toCliErrorMessage,
} from "../../observability";
import {
  runCliExecuteSqlEffect,
  runCliLoadQueryCredentialsEffect,
  runCliPersistQueryUsageEffect,
  runCliValidateQueryEffect,
} from "../../query/effects";
import {
  appendCliQueryActionTrailEvent,
  createCliQueryActionTrail,
} from "../../query/logging";
import type { CliQueryActionTrailActor } from "../../query/logging";
import {
  applyQueryResultWindow,
  resolveQueryResultWindow,
} from "../../query/result-window";
import {
  runCliQueryExecutionWorkflow,
  runCliQueryValidationWorkflow,
} from "../../query/workflow";
import type {
  CliQueryExecutionWorkflowResult,
  CliQueryValidationWorkflowResult,
} from "../../query/workflow";
import { paginateItems } from "../../read-controls-policy";
import { runCliLoadSourceEffect } from "../../source/effects";
import {
  buildCliSanitization,
  sanitizeCliRemoteText,
  sanitizeUndefinedableCliRemoteText,
} from "../../transport/sanitization";
import { requireCliConnectRequestContext } from "../context";
import { CliConnectProblem } from "../error";
import {
  CliQueryLogicalType,
  ExecuteQueryResponseSchema,
  ValidateQueryResponseSchema,
} from "../gen/onequery/cli/v1/query_pb";
import {
  createCliConnectProblemForQueryPlanResult,
  createCliConnectProblemForQueryWorkflowResult,
} from "./errors";
import { buildCliPage, parseCliPaginatedReadControls } from "./read-controls";
import type { CliResultServiceMethod, CliServiceResult } from "./result";
import { createCliServiceProblem, liftCliServiceMethod } from "./result";
import { buildGetSourceResponse } from "./source";

type CliQueryValidationFailure = Exclude<
  CliQueryValidationWorkflowResult,
  { kind: "ready" }
>;

type CliQueryExecutionSuccess = Extract<
  Awaited<ReturnType<typeof runCliQueryExecutionWorkflow>>,
  { kind: "response_ready" }
>;

type CliQueryExecutionFailure = Exclude<
  CliQueryExecutionWorkflowResult,
  { kind: "response_ready" }
>;

type ValidateQueryResponseInit = MessageInitShape<
  typeof ValidateQueryResponseSchema
>;
type ExecuteQueryResponseInit = MessageInitShape<
  typeof ExecuteQueryResponseSchema
>;

type ExecuteQueryColumnMessage = {
  name?: string;
  logicalType?: CliQueryLogicalType;
};

type ExecuteQueryRowMessage = {
  values: string[];
};

type ExecuteQueryPayload = {
  source?: ReturnType<typeof buildGetSourceResponse>;
  rowCount?: bigint;
  elapsedMs?: bigint;
  columns?: ExecuteQueryColumnMessage[];
  rows?: ExecuteQueryRowMessage[];
  truncated?: boolean;
};

function toCliQueryLogicalType(value: string) {
  switch (value) {
    case "string":
      return CliQueryLogicalType.STRING;
    case "number":
      return CliQueryLogicalType.NUMBER;
    case "boolean":
      return CliQueryLogicalType.BOOLEAN;
    case "bigint":
      return CliQueryLogicalType.BIGINT;
    case "datetime":
      return CliQueryLogicalType.DATETIME;
    case "array":
      return CliQueryLogicalType.ARRAY;
    case "json":
      return CliQueryLogicalType.JSON;
    default:
      return undefined;
  }
}

const handleValidateQueryImpl: CliResultServiceMethod<"validateQuery"> = async (
  request,
  context
) =>
  Result.gen(async function* handleValidateQueryFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const requestId = requestContext.requestId;
    const session = yield* Result.await(requestContext.resolveSession());
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action: "query.execute",
        orgSlug: request.orgSlug,
        session,
      })
    );
    const query = request.query as NonNullable<typeof request.query>;
    const resultWindow = resolveQueryResultWindow(query);
    const actionTrail = yield* Result.await(
      createCliQueryActionTrailResult({
        actionType: "validate",
        actor: buildCliQueryActionTrailActor({
          authorizedOrg,
          session,
        }),
        c,
        cellMaxChars: resultWindow.cellMaxChars,
        db: c.var.storage.db,
        maxBytes: resultWindow.maxBytes,
        maxRows: resultWindow.maxRows,
        organizationId: authorizedOrg.org.id,
        requestId,
        sourceKey: request.sourceKey,
        sql: query.sql,
        timeoutMs: resultWindow.timeoutMs,
      })
    );
    const result = yield* Result.await(
      catchCliServiceProblem(() =>
        runCliQueryValidationWorkflow({
          dispatch: {
            loadSource: async (effect) =>
              runCliLoadSourceEffect({
                db: c.var.storage.db,
                effect,
              }),
            validateQuery: runCliValidateQueryEffect,
          },
          org: authorizedOrg.org,
          requestId,
          sourceName: request.sourceKey,
          sql: query.sql,
          timeoutMs: resultWindow.timeoutMs,
          observeEvent: async (event) => {
            await appendCliQueryActionTrailEvent({
              actionId: actionTrail.actionId,
              db: c.var.storage.db,
              event,
            });
          },
          observeEventFailure: async ({ error, event }) => {
            logCliQueryActionTrailFailure({
              actionType: "validate",
              c,
              error,
              eventType: event.type,
              operation: "append",
              sourceKey: request.sourceKey,
            });
            throw createCliQueryActionTrailFailureProblem({
              actionType: "validate",
              cause: error,
              eventType: event.type,
              operation: "append",
              sourceKey: request.sourceKey,
            });
          },
        })
      )
    );

    if (result.kind !== "ready") {
      logCliQueryValidationFailure(c, request.sourceKey, result);
      return Result.err(createCliConnectProblemForQueryPlanResult(result));
    }

    logCliQueryValidationAccepted({
      c,
      provider: result.source.provider,
      sourceKey: request.sourceKey,
      truncated: result.truncated,
    });

    return Result.ok(
      buildQueryValidateResponse({
        request: {
          sql: result.normalizedSql,
          parameters: [],
          maxRows: resultWindow.maxRows,
          maxBytes: resultWindow.maxBytes,
          cellMaxChars: resultWindow.cellMaxChars,
          timeoutMs: resultWindow.timeoutMs,
        },
        normalizedSql: result.normalizedSql,
        declaredResultWindow: {
          maxRows: resultWindow.maxRows,
          maxBytes: resultWindow.maxBytes,
          cellMaxChars: resultWindow.cellMaxChars,
          timeoutMs: resultWindow.timeoutMs,
        },
        source: result.source,
        truncated: result.truncated,
      }) satisfies ValidateQueryResponseInit
    );
  });

const handleExecuteQueryImpl: CliResultServiceMethod<"executeQuery"> = async (
  request,
  context
) =>
  Result.gen(async function* handleExecuteQueryFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const requestId = requestContext.requestId;
    const readControls = yield* parseCliPaginatedReadControls(request);
    const session = yield* Result.await(requestContext.resolveSession());
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action: "query.execute",
        orgSlug: request.orgSlug,
        session,
      })
    );
    const query = request.query as NonNullable<typeof request.query>;
    const resultWindow = resolveQueryResultWindow(query);
    const startedAtMs = Date.now();
    const actionTrail = yield* Result.await(
      createCliQueryActionTrailResult({
        actionType: "execute",
        actor: buildCliQueryActionTrailActor({
          authorizedOrg,
          session,
        }),
        c,
        cellMaxChars: resultWindow.cellMaxChars,
        db: c.var.storage.db,
        maxBytes: resultWindow.maxBytes,
        maxRows: resultWindow.maxRows,
        organizationId: authorizedOrg.org.id,
        requestId,
        sourceKey: request.sourceKey,
        sql: query.sql,
        timeoutMs: resultWindow.timeoutMs,
      })
    );
    const result = yield* Result.await(
      catchCliServiceProblem(() =>
        runCliQueryExecutionWorkflow({
          dispatch: {
            loadSource: async (effect) =>
              runCliLoadSourceEffect({
                db: c.var.storage.db,
                effect,
              }),
            validateQuery: runCliValidateQueryEffect,
            loadCredentials: async (effect) =>
              runCliLoadQueryCredentialsEffect({
                db: c.var.storage.db,
                masterEncryptionKey: c.var.runtime.crypto.masterEncryptionKey,
                effect,
              }),
            executeSql: async (effect) =>
              runCliExecuteSqlEffect({
                db: c.var.storage.db,
                effect,
              }),
            persistUsage: async (effect) =>
              runCliPersistQueryUsageEffect({
                db: c.var.storage.db,
                effect,
              }),
          },
          org: authorizedOrg.org,
          requestId,
          sourceName: request.sourceKey,
          sql: query.sql,
          timeoutMs: resultWindow.timeoutMs,
          observeEvent: async (event) => {
            await appendCliQueryActionTrailEvent({
              actionId: actionTrail.actionId,
              db: c.var.storage.db,
              event,
            });
          },
          observeEventFailure: async ({ error, event }) => {
            logCliQueryActionTrailFailure({
              actionType: "execute",
              c,
              error,
              eventType: event.type,
              operation: "append",
              sourceKey: request.sourceKey,
            });
            throw createCliQueryActionTrailFailureProblem({
              actionType: "execute",
              cause: error,
              eventType: event.type,
              operation: "append",
              sourceKey: request.sourceKey,
            });
          },
        })
      )
    );
    const durationMs = Math.max(0, Date.now() - startedAtMs);

    recordCliHistogramMetric({
      name: "cli.query.latency_ms",
      tags: {
        outcome: result.kind === "response_ready" ? "succeeded" : result.kind,
      },
      value: durationMs,
    });

    if (result.kind !== "response_ready") {
      logCliQueryExecutionFailure({
        c,
        durationMs,
        result,
        sourceKey: request.sourceKey,
      });

      return Result.err(createCliConnectProblemForQueryWorkflowResult(result));
    }

    const windowedRows = applyQueryResultWindow({
      cellMaxChars: resultWindow.cellMaxChars,
      maxBytes: resultWindow.maxBytes,
      maxRows: resultWindow.maxRows,
      rows: result.response.rows,
    });
    const windowedResponse = {
      ...result.response,
      rows: windowedRows.rows,
      truncated: result.response.truncated || windowedRows.truncated,
    };

    logCliQueryExecutionSuccess({
      c,
      durationMs,
      response: windowedResponse,
      sourceKey: request.sourceKey,
      usagePersistence: result.usagePersistence,
    });

    const page = paginateItems(windowedResponse.rows, readControls);
    const data = buildQueryExecuteResponse({
      columns: windowedResponse.columns,
      elapsedMs: windowedResponse.elapsedMs,
      rowCount: windowedResponse.rowCount,
      rows: page.items,
      source: windowedResponse.source,
      truncated: windowedResponse.truncated,
    });
    const sanitizedPaths = resolveQueryExecuteSanitizedPaths(
      page.items.length > 0
    );

    return Result.ok({
      ...sanitizeQueryExecuteResponse(data),
      page: buildCliPage(page.page),
      sanitization: buildCliSanitization(sanitizedPaths),
    } satisfies ExecuteQueryResponseInit);
  });

export const handleValidateQuery = liftCliServiceMethod(
  handleValidateQueryImpl
);

export const handleExecuteQuery = liftCliServiceMethod(handleExecuteQueryImpl);

function buildCliQueryActionTrailActor(input: {
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

function logCliQueryActionTrailFailure(input: {
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

async function createCliQueryActionTrailResult(
  input: Parameters<typeof createCliQueryActionTrail>[0] & {
    c: Parameters<typeof buildCliRequestLogDetails>[0];
  }
) {
  const { c, ...createInput } = input;

  return Result.tryPromise({
    try: () => createCliQueryActionTrail(createInput),
    catch: (error) => {
      logCliQueryActionTrailFailure({
        actionType: input.actionType,
        c,
        error,
        operation: "create",
        sourceKey: input.sourceKey,
      });

      return createCliQueryActionTrailFailureProblem({
        actionType: input.actionType,
        cause: error,
        operation: "create",
        sourceKey: input.sourceKey,
      });
    },
  });
}

async function catchCliServiceProblem<T>(
  run: () => Promise<T>
): Promise<CliServiceResult<T>> {
  try {
    return Result.ok(await run());
  } catch (error) {
    if (error instanceof CliConnectProblem) {
      return Result.err(error);
    }

    throw error;
  }
}

function createCliQueryActionTrailFailureProblem(input: {
  actionType: "execute" | "validate";
  operation: "create" | "append";
  sourceKey: string;
  eventType?: string;
  cause?: unknown;
}) {
  const detail =
    input.operation === "create"
      ? `query action trail could not be created for ${input.actionType} on source "${input.sourceKey}"`
      : `query action trail could not append ${input.eventType ?? "workflow"} for ${input.actionType} on source "${input.sourceKey}"`;

  return createCliServiceProblem({
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
    detail,
    key: "QUERY_PREPARATION_FAILED",
  });
}

function buildQueryValidateResponse(response: {
  request: {
    sql: string;
    parameters: readonly unknown[];
    maxRows: number;
    maxBytes: number;
    cellMaxChars: number;
    timeoutMs: number;
  };
  normalizedSql: string;
  declaredResultWindow: {
    maxRows: number;
    maxBytes: number;
    cellMaxChars: number;
    timeoutMs: number;
  };
  source: Parameters<typeof buildGetSourceResponse>[0];
  truncated: boolean;
}): ValidateQueryResponseInit {
  return {
    request: {
      sql: response.request.sql,
      parameters: [],
      maxRows: response.request.maxRows,
      maxBytes: response.request.maxBytes,
      cellMaxChars: response.request.cellMaxChars,
      timeoutMs: response.request.timeoutMs,
    },
    normalizedSql: response.normalizedSql,
    declaredResultWindow: {
      maxRows: response.declaredResultWindow.maxRows,
      maxBytes: response.declaredResultWindow.maxBytes,
      cellMaxChars: response.declaredResultWindow.cellMaxChars,
      timeoutMs: response.declaredResultWindow.timeoutMs,
    },
    source: buildGetSourceResponse(response.source),
    truncated: response.truncated,
  };
}

function logCliQueryValidationFailure(
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

function logCliQueryValidationAccepted(input: {
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

function buildQueryExecuteResponse(response: {
  source: Parameters<typeof buildGetSourceResponse>[0];
  rowCount: number;
  elapsedMs: number;
  columns: readonly { name: string; logicalType: string | null }[];
  rows: readonly (readonly string[])[];
  truncated: boolean;
}): ExecuteQueryPayload {
  const columns = response.columns.map(buildCliQueryColumn);
  const rows = response.rows.map(buildCliQueryRow);

  return {
    source: buildGetSourceResponse(response.source),
    rowCount: BigInt(response.rowCount),
    elapsedMs: BigInt(response.elapsedMs),
    columns,
    rows,
    truncated: response.truncated,
  };
}

function buildCliQueryColumn(column: {
  name: string;
  logicalType: string | null;
}): ExecuteQueryColumnMessage {
  return {
    name: column.name,
    ...(column.logicalType
      ? { logicalType: toCliQueryLogicalType(column.logicalType) }
      : {}),
  };
}

function buildCliQueryRow(row: readonly string[]): ExecuteQueryRowMessage {
  return {
    values: [...row],
  };
}

function logCliQueryExecutionFailure(input: {
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

function logCliQueryExecutionSuccess(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  response: Pick<
    CliQueryExecutionSuccess["response"],
    "source" | "rowCount" | "elapsedMs" | "truncated"
  >;
  durationMs: number;
  usagePersistence: CliQueryExecutionSuccess["usagePersistence"];
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

function sanitizeQueryExecuteResponse(
  data: ExecuteQueryPayload
): ExecuteQueryPayload {
  return {
    ...data,
    columns: Array.isArray(data.columns)
      ? data.columns.map((column) => ({
          ...column,
          name: sanitizeUndefinedableCliRemoteText(column.name),
        }))
      : data.columns,
    rows: Array.isArray(data.rows)
      ? data.rows.map((row) => ({
          ...row,
          values: Array.isArray(row.values)
            ? row.values.map(sanitizeCliRemoteText)
            : row.values,
        }))
      : data.rows,
  };
}

function resolveQueryExecuteSanitizedPaths(hasRows: boolean) {
  return hasRows
    ? ["$.columns[*].name", "$.rows[*].values[*]"]
    : ["$.columns[*].name"];
}
