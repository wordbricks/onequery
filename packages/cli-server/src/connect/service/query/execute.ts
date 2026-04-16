import { Result } from "better-result";

import { recordCliHistogramMetric } from "../../../observability";
import { applyQueryResultWindow } from "../../../query/result-window";
import { paginateItems } from "../../../read-controls-policy";
import { createCliConnectProblemForQueryWorkflowResult } from "../errors";
import { buildCliPage, parseCliPaginatedReadControls } from "../read-controls";
import type { CliResultServiceMethod } from "../result";
import { liftCliServiceMethod } from "../result";
import {
  createCliQueryActionTrailForRequest,
  createCliQueryWorkflowObserver,
} from "./action-trail";
import { resolveCliQueryRequestState } from "./context";
import { createCliQueryExecutionDispatch } from "./dispatch";
import {
  logCliQueryExecutionFailure,
  logCliQueryExecutionSuccess,
} from "./logging";
import {
  buildQueryExecuteResponse,
  buildQueryExecuteSanitization,
  sanitizeQueryExecuteResponse,
} from "./response";
import { runCliQueryExecutionWorkflowResult } from "./workflow";

const handleExecuteQueryImpl: CliResultServiceMethod<"executeQuery"> = async (
  request,
  context
) =>
  Result.gen(async function* handleExecuteQueryFlow() {
    const resolved = yield* Result.await(
      resolveCliQueryRequestState(request, context)
    );
    const readControls = yield* parseCliPaginatedReadControls(request);
    const startedAtMs = Date.now();
    const actionTrail = yield* Result.await(
      createCliQueryActionTrailForRequest({
        actionType: "execute",
        authorizedOrg: resolved.authorizedOrg,
        c: resolved.c,
        requestId: resolved.requestId,
        resultWindow: resolved.resultWindow,
        session: resolved.session,
        sourceKey: request.sourceKey,
        sql: resolved.query.sql,
      })
    );
    const observer = createCliQueryWorkflowObserver({
      actionId: actionTrail.actionId,
      actionType: "execute",
      c: resolved.c,
      sourceKey: request.sourceKey,
    });
    const result = yield* Result.await(
      runCliQueryExecutionWorkflowResult({
        dispatch: createCliQueryExecutionDispatch(resolved.c),
        observer,
        org: resolved.authorizedOrg.org,
        requestId: resolved.requestId,
        sourceName: request.sourceKey,
        sql: resolved.query.sql,
        timeoutMs: resolved.resultWindow.timeoutMs,
      })
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
        c: resolved.c,
        durationMs,
        result,
        sourceKey: request.sourceKey,
      });

      return Result.err(createCliConnectProblemForQueryWorkflowResult(result));
    }

    const windowedRows = applyQueryResultWindow({
      cellMaxChars: resolved.resultWindow.cellMaxChars,
      maxBytes: resolved.resultWindow.maxBytes,
      maxRows: resolved.resultWindow.maxRows,
      rows: result.response.rows,
    });
    const windowedResponse = {
      ...result.response,
      rows: windowedRows.rows,
      truncated: result.response.truncated || windowedRows.truncated,
    };

    logCliQueryExecutionSuccess({
      c: resolved.c,
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

    return Result.ok({
      ...sanitizeQueryExecuteResponse(data),
      page: buildCliPage(page.page),
      sanitization: buildQueryExecuteSanitization(page.items.length > 0),
    });
  });

export const handleExecuteQuery = liftCliServiceMethod(handleExecuteQueryImpl);
