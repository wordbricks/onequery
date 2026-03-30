import { createFactory } from "hono/factory";

import type { CliQueryExecuteContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliQueryExecuteBody,
  CliQueryExecuteParams,
  CliQueryExecuteQueryParams,
  CliQueryExecuteResponse,
} from "../../../generated/cli.zod";
import type { CliOrgRouteVariables, CliRouteEnv } from "../../app";
import { cliSessionMiddleware } from "../../auth/middleware";
import { recordCliHistogramMetric } from "../../observability";
import {
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware,
} from "../../organization/middleware";
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
import { throwForCliQueryWorkflowResult } from "../../query/model";
import {
  applyQueryResultWindow,
  resolveQueryResultWindow,
} from "../../query/result-window";
import {
  buildCliQueryActionTrailActor,
  buildQueryExecuteResponse,
  logCliQueryActionTrailFailure,
  logCliQueryExecutionFailure,
  logCliQueryExecutionSuccess,
  throwIfCliQueryParametersProvided,
  throwCliQueryActionTrailFailure,
} from "../../query/transport";
import { runCliQueryExecutionWorkflow } from "../../query/workflow";
import { createCliPaginatedReadControlsMiddleware } from "../../read-controls";
import type { CliPaginatedReadControls } from "../../read-controls";
import { paginateItems } from "../../read-controls-policy";
import { runCliLoadSourceEffect } from "../../source/effects";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";
import {
  buildCliSanitization,
  sanitizeCliRemoteText,
  sanitizeUndefinedableCliRemoteText,
} from "../sanitization";

const factory = createFactory();

type QueryExecuteHandlerEnv = CliRouteEnv<
  CliOrgRouteVariables & { readControls: CliPaginatedReadControls }
>;

export const cliQueryExecuteHandlers = factory.createHandlers(
  cliSessionMiddleware,
  zValidator(
    "param",
    CliQueryExecuteParams,
    createCliValidationHook({
      defaultStage: "resolve_source",
      fieldStages: {
        orgSlug: "resolve_org",
        sourceKey: "resolve_source",
      },
      hint: "correct the request and retry",
    })
  ),
  zValidator(
    "query",
    CliQueryExecuteQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid query execution request",
      defaultStage: "read_query_input",
      hint: "correct the request query and retry",
    })
  ),
  createCliPaginatedReadControlsMiddleware({
    allowedFields: [
      "source",
      "source.name",
      "source.displayName",
      "source.provider",
      "source.queryable",
      "source.status",
      "rowCount",
      "elapsedMs",
      "columns",
      "columns.name",
      "columns.logicalType",
      "rows",
      "truncated",
    ],
    defaultStage: "read_query_input",
    hint: "correct the read controls and retry",
  }),
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware("query.execute"),
  zValidator(
    "json",
    CliQueryExecuteBody,
    createCliValidationHook({
      defaultMessage: "invalid query request",
      defaultStage: "read_query_input",
      fieldStages: {
        sql: "read_query_input",
        parameters: "read_query_input",
        maxRows: "read_query_input",
        maxBytes: "read_query_input",
        cellMaxChars: "read_query_input",
        timeoutMs: "read_query_input",
      },
      hint: "correct the request body and retry",
    })
  ),
  zValidator("response", CliQueryExecuteResponse),
  async (c: CliQueryExecuteContext<QueryExecuteHandlerEnv>) => {
    const input = c.req.valid("json");
    const { sourceKey } = c.req.valid("param");

    throwIfCliQueryParametersProvided(input.parameters);

    const resultWindow = resolveQueryResultWindow(input);
    const startedAtMs = Date.now();
    const actionId = (
      await createCliQueryActionTrail({
        actionType: "execute",
        actor: buildCliQueryActionTrailActor({
          authorizedOrg: c.var.authorizedOrg,
          session: c.var.session,
        }),
        cellMaxChars: resultWindow.cellMaxChars,
        db: c.var.db,
        maxBytes: resultWindow.maxBytes,
        maxRows: resultWindow.maxRows,
        organizationId: c.var.authorizedOrg.org.id,
        requestId: c.var.requestId,
        sourceKey,
        sql: input.sql,
        timeoutMs: resultWindow.timeoutMs,
      }).catch((error) => {
        logCliQueryActionTrailFailure({
          actionType: "execute",
          c,
          error,
          operation: "create",
          sourceKey,
        });
        throwCliQueryActionTrailFailure({
          actionType: "execute",
          operation: "create",
          sourceKey,
        });
      })
    ).actionId;
    const result = await runCliQueryExecutionWorkflow({
      dispatch: {
        loadSource: async (effect) =>
          runCliLoadSourceEffect({
            db: c.var.db,
            effect,
          }),
        validateQuery: runCliValidateQueryEffect,
        loadCredentials: async (effect) =>
          runCliLoadQueryCredentialsEffect({
            db: c.var.db,
            masterEncryptionKey: c.env.MASTER_ENCRYPTION_KEY,
            effect,
          }),
        executeSql: async (effect) =>
          runCliExecuteSqlEffect({
            db: c.var.db,
            effect,
          }),
        persistUsage: async (effect) =>
          runCliPersistQueryUsageEffect({
            db: c.var.db,
            effect,
          }),
      },
      org: c.var.authorizedOrg.org,
      requestId: c.var.requestId,
      sourceName: sourceKey,
      sql: input.sql,
      timeoutMs: resultWindow.timeoutMs,
      observeEvent: async (event) => {
        await appendCliQueryActionTrailEvent({
          actionId,
          db: c.var.db,
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
          sourceKey,
        });
        throwCliQueryActionTrailFailure({
          actionType: "execute",
          eventType: event.type,
          operation: "append",
          sourceKey,
        });
      },
    });
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
        sourceKey,
      });
      throwForCliQueryWorkflowResult(result);
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
      sourceKey,
      usagePersistence: result.usagePersistence,
    });

    const page = paginateItems(windowedResponse.rows, c.var.readControls);
    const data = buildQueryExecuteResponse(
      {
        columns: windowedResponse.columns,
        elapsedMs: windowedResponse.elapsedMs,
        rowCount: windowedResponse.rowCount,
        rows: page.items,
        source: windowedResponse.source,
        truncated: windowedResponse.truncated,
      },
      c.var.readControls.selectedFields
    );
    const untrustedPaths = resolveQueryExecuteUntrustedPaths(
      c.var.readControls.selectedFields,
      page.items.length > 0
    );

    return c.json(
      buildCliSuccessEnvelope({
        data: sanitizeQueryExecuteResponse(data),
        page: page.page,
        requestId: c.var.requestId,
        sanitization: buildCliSanitization(untrustedPaths),
        untrustedPaths,
      }),
      200
    );
  }
);

function sanitizeQueryExecuteResponse(
  data: Awaited<ReturnType<typeof buildQueryExecuteResponse>>
) {
  return {
    ...data,
    columns: data.columns?.map((column) => ({
      ...column,
      name: sanitizeUndefinedableCliRemoteText(column.name),
    })),
    rows: data.rows?.map((row) => row.map(sanitizeCliRemoteText)),
  };
}

function resolveQueryExecuteUntrustedPaths(
  selectedFields: CliPaginatedReadControls["selectedFields"],
  hasRows: boolean
): string[] | undefined {
  if (!selectedFields) {
    return hasRows
      ? ["$.data.columns[*].name", "$.data.rows[*][*]"]
      : ["$.data.columns[*].name"];
  }

  const untrustedPaths: string[] = [];
  if (selectedFields.has("columns") || selectedFields.has("columns.name")) {
    untrustedPaths.push("$.data.columns[*].name");
  }
  if (hasRows && selectedFields.has("rows")) {
    untrustedPaths.push("$.data.rows[*][*]");
  }

  return untrustedPaths.length > 0 ? untrustedPaths : undefined;
}
