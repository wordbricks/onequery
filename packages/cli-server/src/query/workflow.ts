import type {
  CliQueryActionType,
  DatabaseCredentialProviderType,
  DatabaseCredentials,
  DataSourceStatus,
  ProviderType,
} from "@onequery/db/server";

import type {
  CliExecuteSqlEffect,
  CliExecuteSqlEffectResult,
  CliLoadCredentialsEffect,
  CliLoadCredentialsEffectResult,
  CliLoadSourceEffect,
  CliLoadSourceEffectResult,
  CliPersistUsageEffect,
  CliPersistUsageEffectResult,
  CliValidateQueryEffect,
  CliValidateQueryEffectResult,
} from "../domain/effects";
import type {
  AccessibleCliOrg,
  CliQueryColumn,
  CliQueryPlanResult,
  CliQuerySourceRecord,
  CliQuerySuccessResult,
} from "../domain/workflows";
import { getCliQueryableDatabaseProviderType } from "../source/model";

type CliQueryWorkflowBase = {
  requestId: string;
  sourceName: string;
  timeoutMs: number | null;
};

type CliLoadQuerySourceState = CliQueryWorkflowBase & {
  kind: "load_source";
  orgSlug: string;
  organizationId: string;
  sql: string;
};

type CliValidateQueryState = CliQueryWorkflowBase & {
  kind: "validate_query";
  source: CliQuerySourceRecord;
  sql: string;
  databaseType: DatabaseCredentialProviderType;
};

type CliLoadQueryCredentialsState = CliQueryWorkflowBase & {
  kind: "load_credentials";
  source: CliQuerySourceRecord;
  normalizedSql: string;
  truncated: boolean;
};

type CliExecuteQueryState = CliQueryWorkflowBase & {
  kind: "execute_query";
  source: CliQuerySourceRecord;
  credentials: DatabaseCredentials;
  sql: string;
  truncated: boolean;
};

type CliPersistQueryUsageState = {
  kind: "persist_usage";
  requestId: string;
  sourceId: string;
  sourceKey: string;
  response: CliQuerySuccessResult;
};

export type CliQueryWorkflowEvent =
  | {
      type: "source_loaded";
      actionType: CliQueryActionType;
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord;
    }
  | {
      type: "source_not_found";
      actionType: CliQueryActionType;
      requestId: string;
      sourceKey: string;
      orgSlug: string;
    }
  | {
      type: "source_not_queryable";
      actionType: CliQueryActionType;
      requestId: string;
      sourceKey: string;
      provider: ProviderType;
      sourceStatus: DataSourceStatus;
    }
  | {
      type: "query_validated";
      actionType: CliQueryActionType;
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord;
      normalizedSql: string;
      normalizedSqlChanged: boolean;
    }
  | {
      type: "query_rejected";
      actionType: CliQueryActionType;
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord;
      detail: string;
    }
  | {
      type: "credentials_loaded";
      actionType: "execute";
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord;
    }
  | {
      type: "query_preparation_failed";
      actionType: CliQueryActionType;
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord | null;
      detail: string;
      hint?: string;
    }
  | {
      type: "query_executed";
      actionType: "execute";
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord;
      rowCount: number;
      elapsedMs: number;
    }
  | {
      type: "query_unavailable";
      actionType: "execute";
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord;
      detail: string;
    }
  | {
      type: "query_timed_out";
      actionType: "execute";
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord;
      detail: string;
    }
  | {
      type: "query_execution_failed";
      actionType: "execute";
      requestId: string;
      sourceKey: string;
      source: CliQuerySourceRecord;
      detail: string;
    }
  | {
      type: "usage_persisted";
      actionType: "execute";
      requestId: string;
      sourceKey: string;
      sourceId: string;
    }
  | {
      type: "usage_persist_failed";
      actionType: "execute";
      requestId: string;
      sourceKey: string;
      sourceId: string;
      detail: string;
    };

type CliQueryWorkflowObserver = {
  observeEvent?: (event: CliQueryWorkflowEvent) => Promise<void> | void;
  observeEventFailure?: (input: {
    event: CliQueryWorkflowEvent;
    error: unknown;
  }) => Promise<void> | void;
};

export type CliQueryExecutionWorkflowResult =
  | {
      kind: "response_ready";
      response: CliQuerySuccessResult;
      usagePersistence: CliPersistUsageEffectResult;
    }
  | {
      kind: "source_not_found";
      orgSlug: string;
      sourceName: string;
      requestId: string;
    }
  | {
      kind: "source_not_queryable";
      requestId: string;
      sourceName: string;
      provider: ProviderType;
      status: DataSourceStatus;
    }
  | {
      kind: "query_rejected";
      requestId: string;
      detail: string;
    }
  | {
      kind: "query_preparation_failed";
      requestId: string;
      detail: string;
      hint?: string;
    }
  | {
      kind: "query_unavailable";
      requestId: string;
      detail: string;
      retryable: true;
    }
  | {
      kind: "query_timed_out";
      requestId: string;
      detail: string;
      retryable: true;
    }
  | {
      kind: "query_execution_failed";
      requestId: string;
      detail: string;
      retryable: false;
    };

type CliQueryExecutionWorkflowState =
  | CliLoadQuerySourceState
  | CliValidateQueryState
  | CliLoadQueryCredentialsState
  | CliExecuteQueryState
  | CliPersistQueryUsageState
  | CliQueryExecutionWorkflowResult;

type CliQueryExecutionDispatch = {
  loadSource: (
    effect: CliLoadSourceEffect
  ) => Promise<CliLoadSourceEffectResult>;
  validateQuery: (
    effect: CliValidateQueryEffect
  ) => Promise<CliValidateQueryEffectResult>;
  loadCredentials: (
    effect: CliLoadCredentialsEffect
  ) => Promise<CliLoadCredentialsEffectResult>;
  executeSql: (
    effect: CliExecuteSqlEffect
  ) => Promise<CliExecuteSqlEffectResult>;
  persistUsage: (
    effect: CliPersistUsageEffect
  ) => Promise<CliPersistUsageEffectResult>;
};

export type CliQueryValidationWorkflowResult = CliQueryPlanResult;

export function startCliQueryExecutionWorkflow(input: {
  org: AccessibleCliOrg;
  requestId: string;
  sourceName: string;
  sql: string;
  timeoutMs: number | null | undefined;
}): CliQueryExecutionWorkflowState {
  return {
    kind: "load_source",
    orgSlug: input.org.slug,
    organizationId: input.org.id,
    requestId: input.requestId,
    sourceName: input.sourceName,
    sql: input.sql,
    timeoutMs: input.timeoutMs ?? null,
  };
}

export function finishCliQuerySourceLookup(input: {
  state: CliLoadQuerySourceState;
  source: CliLoadSourceEffectResult;
}): CliQueryExecutionWorkflowState {
  if (input.source.kind === "not_found") {
    return {
      kind: "source_not_found",
      orgSlug: input.state.orgSlug,
      requestId: input.state.requestId,
      sourceName: input.state.sourceName,
    };
  }

  return planCliQuery({
    requestId: input.state.requestId,
    source: input.source.source,
    sourceName: input.state.sourceName,
    sql: input.state.sql,
    timeoutMs: input.state.timeoutMs,
  });
}

export function finishCliQueryValidation(input: {
  state: CliValidateQueryState;
  validation: CliValidateQueryEffectResult;
}): CliQueryExecutionWorkflowState {
  if (input.validation.kind === "query_rejected") {
    return {
      detail: input.validation.detail,
      kind: "query_rejected",
      requestId: input.state.requestId,
    };
  }

  return {
    kind: "load_credentials",
    normalizedSql: input.validation.normalizedSql,
    requestId: input.state.requestId,
    source: input.state.source,
    sourceName: input.state.sourceName,
    timeoutMs: input.state.timeoutMs,
    truncated: input.validation.truncated,
  };
}

export function finishCliQueryCredentialsLoad(input: {
  state: CliLoadQueryCredentialsState;
  credentials: CliLoadCredentialsEffectResult;
}): CliQueryExecutionWorkflowState {
  if (input.credentials.kind === "credentials_invalid") {
    return {
      detail: input.credentials.detail,
      hint: "verify the source configuration and retry",
      kind: "query_preparation_failed",
      requestId: input.state.requestId,
    };
  }

  return {
    credentials: input.credentials.credentials,
    kind: "execute_query",
    requestId: input.state.requestId,
    source: input.state.source,
    sourceName: input.state.sourceName,
    sql: input.state.normalizedSql,
    timeoutMs: input.state.timeoutMs,
    truncated: input.state.truncated,
  };
}

export function finishCliQueryExecution(input: {
  state: CliExecuteQueryState;
  execution: CliExecuteSqlEffectResult;
}): CliQueryExecutionWorkflowState {
  if (input.execution.kind !== "succeeded") {
    switch (input.execution.kind) {
      case "query_unavailable": {
        return {
          kind: "query_unavailable",
          requestId: input.state.requestId,
          detail: input.execution.detail,
          retryable: true,
        };
      }
      case "query_timed_out": {
        return {
          kind: "query_timed_out",
          requestId: input.state.requestId,
          detail: input.execution.detail,
          retryable: true,
        };
      }
      case "query_execution_failed": {
        return {
          kind: "query_execution_failed",
          requestId: input.state.requestId,
          detail: input.execution.detail,
          retryable: false,
        };
      }
    }
  }

  return {
    kind: "persist_usage",
    requestId: input.state.requestId,
    response: buildCliQuerySuccessResponse({
      source: input.state.source,
      rows: input.execution.rows,
      elapsedMs: input.execution.elapsedMs,
      truncated: input.state.truncated,
    }),
    sourceId: input.state.source.id,
    sourceKey: input.state.sourceName,
  };
}

function finishCliQueryUsagePersistence(input: {
  state: CliPersistQueryUsageState;
  usagePersistence: CliPersistUsageEffectResult;
}): CliQueryExecutionWorkflowResult {
  // Usage persistence is intentionally best-effort and must not block the
  // query result once execution has succeeded.
  return {
    kind: "response_ready",
    response: input.state.response,
    usagePersistence: input.usagePersistence,
  };
}

type CliQueryWorkflowObservationFailure = {
  kind: "query_preparation_failed";
  requestId: string;
  detail: string;
};

function createCliQueryWorkflowObservationFailure(
  requestId: string
): CliQueryWorkflowObservationFailure {
  // Comment: workflow event observation sits outside the query state machine
  // proper. When that deferred effect fails, terminate deterministically here
  // and let outer adapters surface the effect-specific failure.
  return {
    kind: "query_preparation_failed",
    requestId,
    detail: "query workflow event observation failed",
  };
}

export async function runCliQueryExecutionWorkflow(
  input: {
    org: AccessibleCliOrg;
    requestId: string;
    sourceName: string;
    sql: string;
    timeoutMs: number | null | undefined;
    dispatch: CliQueryExecutionDispatch;
  } & CliQueryWorkflowObserver
): Promise<CliQueryExecutionWorkflowResult> {
  let state = startCliQueryExecutionWorkflow(input);

  for (;;) {
    switch (state.kind) {
      case "load_source": {
        const next = finishCliQuerySourceLookup({
          state,
          source: await input.dispatch.loadSource({
            kind: "load_source",
            organizationId: state.organizationId,
            sourceKey: state.sourceName,
          }),
        });
        switch (next.kind) {
          case "validate_query": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                requestId: next.requestId,
                source: next.source,
                sourceKey: state.sourceName,
                type: "source_loaded",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
          case "source_not_found": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                orgSlug: next.orgSlug,
                requestId: next.requestId,
                sourceKey: state.sourceName,
                type: "source_not_found",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
          case "source_not_queryable": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                provider: next.provider,
                requestId: next.requestId,
                sourceKey: state.sourceName,
                sourceStatus: next.status,
                type: "source_not_queryable",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
        }
        state = next;
        break;
      }
      case "validate_query": {
        const next = finishCliQueryValidation({
          state,
          validation: await input.dispatch.validateQuery({
            kind: "validate_query",
            sql: state.sql,
            databaseType: state.databaseType,
          }),
        });
        switch (next.kind) {
          case "load_credentials": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                normalizedSql: next.normalizedSql,
                normalizedSqlChanged: next.truncated,
                requestId: next.requestId,
                source: next.source,
                sourceKey: state.sourceName,
                type: "query_validated",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
          case "query_rejected": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                detail: next.detail,
                requestId: next.requestId,
                source: state.source,
                sourceKey: state.sourceName,
                type: "query_rejected",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
        }
        state = next;
        break;
      }
      case "load_credentials": {
        const next = finishCliQueryCredentialsLoad({
          state,
          credentials: await input.dispatch.loadCredentials({
            kind: "load_credentials",
            source: state.source,
          }),
        });
        switch (next.kind) {
          case "execute_query": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                requestId: next.requestId,
                source: next.source,
                sourceKey: state.sourceName,
                type: "credentials_loaded",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
          case "query_preparation_failed": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                detail: next.detail,
                hint: next.hint,
                requestId: next.requestId,
                source: state.source,
                sourceKey: state.sourceName,
                type: "query_preparation_failed",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
        }
        state = next;
        break;
      }
      case "execute_query": {
        const next = finishCliQueryExecution({
          state,
          execution: await input.dispatch.executeSql({
            kind: "execute_sql",
            requestId: state.requestId,
            source: state.source,
            credentials: state.credentials,
            sql: state.sql,
            clientTimeoutMs: state.timeoutMs,
          }),
        });
        switch (next.kind) {
          case "persist_usage": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                elapsedMs: next.response.elapsedMs,
                requestId: state.requestId,
                rowCount: next.response.rowCount,
                source: state.source,
                sourceKey: state.sourceName,
                type: "query_executed",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(state.requestId);
            }
            break;
          }
          case "query_unavailable": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                detail: next.detail,
                requestId: next.requestId,
                source: state.source,
                sourceKey: state.sourceName,
                type: "query_unavailable",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
          case "query_timed_out": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                detail: next.detail,
                requestId: next.requestId,
                source: state.source,
                sourceKey: state.sourceName,
                type: "query_timed_out",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
          case "query_execution_failed": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "execute",
                detail: next.detail,
                requestId: next.requestId,
                source: state.source,
                sourceKey: state.sourceName,
                type: "query_execution_failed",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
        }
        state = next;
        break;
      }
      case "persist_usage": {
        const usagePersistence = await input.dispatch.persistUsage({
          kind: "persist_usage",
          sourceId: state.sourceId,
        });
        if (
          !(await emitCliQueryWorkflowEvent(
            input,
            usagePersistence.kind === "usage_persisted"
              ? {
                  actionType: "execute",
                  requestId: state.requestId,
                  sourceId: state.sourceId,
                  sourceKey: state.sourceKey,
                  type: "usage_persisted",
                }
              : {
                  actionType: "execute",
                  detail: usagePersistence.detail,
                  requestId: state.requestId,
                  sourceId: state.sourceId,
                  sourceKey: state.sourceKey,
                  type: "usage_persist_failed",
                }
          ))
        ) {
          return createCliQueryWorkflowObservationFailure(state.requestId);
        }
        return finishCliQueryUsagePersistence({
          state,
          usagePersistence,
        });
      }
      case "response_ready":
      case "source_not_found":
      case "source_not_queryable":
      case "query_rejected":
      case "query_preparation_failed":
      case "query_unavailable":
      case "query_timed_out":
      case "query_execution_failed": {
        return state;
      }
    }
  }
}

export async function runCliQueryValidationWorkflow(
  input: {
    org: AccessibleCliOrg;
    requestId: string;
    sourceName: string;
    sql: string;
    timeoutMs: number | null | undefined;
    dispatch: Pick<CliQueryExecutionDispatch, "loadSource" | "validateQuery">;
  } & CliQueryWorkflowObserver
): Promise<CliQueryValidationWorkflowResult> {
  let state = startCliQueryExecutionWorkflow(input);

  for (;;) {
    switch (state.kind) {
      case "load_source": {
        const next = finishCliQuerySourceLookup({
          state,
          source: await input.dispatch.loadSource({
            kind: "load_source",
            organizationId: state.organizationId,
            sourceKey: state.sourceName,
          }),
        });
        switch (next.kind) {
          case "validate_query": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "validate",
                requestId: next.requestId,
                source: next.source,
                sourceKey: state.sourceName,
                type: "source_loaded",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
          case "source_not_found": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "validate",
                orgSlug: next.orgSlug,
                requestId: next.requestId,
                sourceKey: state.sourceName,
                type: "source_not_found",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
          case "source_not_queryable": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "validate",
                provider: next.provider,
                requestId: next.requestId,
                sourceKey: state.sourceName,
                sourceStatus: next.status,
                type: "source_not_queryable",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            break;
          }
        }
        state = next;
        break;
      }
      case "validate_query": {
        const next = finishCliQueryValidation({
          state,
          validation: await input.dispatch.validateQuery({
            databaseType: state.databaseType,
            kind: "validate_query",
            sql: state.sql,
          }),
        });

        switch (next.kind) {
          case "load_credentials": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "validate",
                normalizedSql: next.normalizedSql,
                normalizedSqlChanged: next.truncated,
                requestId: next.requestId,
                source: next.source,
                sourceKey: state.sourceName,
                type: "query_validated",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            return {
              kind: "ready",
              requestId: next.requestId,
              sourceName: next.sourceName,
              source: next.source,
              normalizedSql: next.normalizedSql,
              timeoutMs: next.timeoutMs,
              truncated: next.truncated,
            };
          }
          case "query_rejected": {
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "validate",
                detail: next.detail,
                requestId: next.requestId,
                source: state.source,
                sourceKey: state.sourceName,
                type: "query_rejected",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(next.requestId);
            }
            return next;
          }
          default: {
            const failure: CliQueryValidationWorkflowResult = {
              kind: "query_preparation_failed",
              requestId: state.requestId,
              detail: "unexpected query validation state",
            };
            if (
              !(await emitCliQueryWorkflowEvent(input, {
                actionType: "validate",
                detail: failure.detail,
                requestId: failure.requestId,
                source: state.source,
                sourceKey: state.sourceName,
                type: "query_preparation_failed",
              }))
            ) {
              return createCliQueryWorkflowObservationFailure(
                failure.requestId
              );
            }
            return failure;
          }
        }
      }
      case "source_not_found":
      case "source_not_queryable":
      case "query_rejected":
      case "query_preparation_failed": {
        return state;
      }
      default: {
        const failure: CliQueryValidationWorkflowResult = {
          kind: "query_preparation_failed",
          requestId: input.requestId,
          detail: `unexpected query validation state: ${state.kind}`,
        };
        if (
          !(await emitCliQueryWorkflowEvent(input, {
            actionType: "validate",
            detail: failure.detail,
            requestId: failure.requestId,
            source: null,
            sourceKey: input.sourceName,
            type: "query_preparation_failed",
          }))
        ) {
          return createCliQueryWorkflowObservationFailure(failure.requestId);
        }
        return failure;
      }
    }
  }
}

async function emitCliQueryWorkflowEvent(
  observer: CliQueryWorkflowObserver,
  event: CliQueryWorkflowEvent
): Promise<boolean> {
  if (!observer.observeEvent) {
    return true;
  }

  try {
    await observer.observeEvent(event);
    return true;
  } catch (error) {
    if (observer.observeEventFailure) {
      await observer.observeEventFailure({
        error,
        event,
      });
    }
    return false;
  }
}

function planCliQuery(input: {
  requestId: string;
  sourceName: string;
  source: CliQuerySourceRecord;
  sql: string;
  timeoutMs: number | null;
}): CliQueryExecutionWorkflowState {
  const databaseType = getCliQueryableDatabaseProviderType(
    input.source.provider,
    input.source.status
  );
  if (!databaseType) {
    return {
      kind: "source_not_queryable",
      provider: input.source.provider,
      requestId: input.requestId,
      sourceName: input.source.sourceKey,
      status: input.source.status,
    };
  }

  return {
    databaseType,
    kind: "validate_query",
    requestId: input.requestId,
    source: input.source,
    sourceName: input.sourceName,
    sql: input.sql,
    timeoutMs: input.timeoutMs,
  };
}

export function buildCliQuerySuccessResponse(input: {
  source: CliQuerySourceRecord;
  rows: Record<string, unknown>[];
  elapsedMs: number;
  truncated: boolean;
}): CliQuerySuccessResult {
  const columns = [
    ...input.rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => {
        set.add(key);
      });
      return set;
    }, new Set<string>()),
  ];

  return {
    columns: columns.map((name) => ({
      name,
      logicalType: inferLogicalType(name, input.rows),
    })),
    elapsedMs: Math.max(0, Math.trunc(input.elapsedMs)),
    rowCount: input.rows.length,
    rows: input.rows.map((row) =>
      columns.map((column) => normalizeCell(row[column]))
    ),
    source: {
      displayName: input.source.displayName,
      id: input.source.id,
      provider: input.source.provider,
      sourceKey: input.source.sourceKey,
      status: input.source.status,
    },
    truncated: input.truncated,
  };
}

function inferLogicalType(
  column: string,
  rows: Record<string, unknown>[]
): CliQueryColumn["logicalType"] {
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined) {
      continue;
    }

    if (value instanceof Date) {
      return "datetime";
    }

    if (Array.isArray(value)) {
      return "array";
    }

    switch (typeof value) {
      case "string": {
        return "string";
      }
      case "number": {
        return "number";
      }
      case "boolean": {
        return "boolean";
      }
      case "bigint": {
        return "bigint";
      }
      case "object": {
        return "json";
      }
      default: {
        return null;
      }
    }
  }

  return null;
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
