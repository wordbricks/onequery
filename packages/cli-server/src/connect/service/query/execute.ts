import { Result } from "better-result";

import { recordCliHistogramMetric } from "../../../observability";
import { applyQueryResultWindow } from "../../../query/result-window";
import { paginateItems } from "../../../read-controls-policy";
import { createCliFailureForQueryWorkflowResult } from "../errors";
import { buildCliPage, parseCliPageRequest } from "../read-controls";
import type { CliResultServiceMethod } from "../result";
import { liftCliServiceMethod } from "../result";
import { resolveCliQueryRequestState } from "./context";
import { createCliQueryExecutionDispatch } from "./dispatch";
import {
  logCliQueryExecutionFailure,
  logCliQueryExecutionSuccess,
} from "./logging";
import { createQueryWorkflowResourceCache } from "./resource-cache";
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
    const readControls = yield* parseCliPageRequest({
      invalidRequestKey: "EXECUTE_QUERY_REQUEST_INVALID",
      page: request.page,
    });
    const startedAtMs = Date.now();
    const workflowResult = await runCliQueryExecutionWorkflowResult({
      actorSnapshot: {
        authMode: resolved.session.authMode,
        email: resolved.session.user.email,
        membershipRoles: [...resolved.authorizedOrg.membershipRoles],
        userId: resolved.session.user.id,
      },
      db: resolved.c.var.storage.db,
      dispatch: createCliQueryExecutionDispatch(resolved.c),
      org: resolved.authorizedOrg.org,
      requestId: resolved.requestId,
      resourceCache: createQueryWorkflowResourceCache({
        organizationId: resolved.authorizedOrg.org.id,
        sourceKey: resolved.sourceKey,
        sourceLookup: resolved.sourceLookup,
      }),
      sourceName: resolved.sourceKey,
      sql: resolved.query.sql,
      timeoutMs: resolved.resultWindow.timeoutMs,
    });

    const result = yield* workflowResult;
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
        sourceKey: resolved.sourceKey,
      });

      return Result.err(createCliFailureForQueryWorkflowResult(result));
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
      sourceKey: resolved.sourceKey,
    });

    const page = selectQueryResponseRows({
      allPages: request.allPages,
      readControls,
      rows: windowedResponse.rows,
    });
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

export function selectQueryResponseRows<Row>(input: {
  allPages: boolean;
  readControls: { limit: number; offset: number };
  rows: readonly Row[];
}) {
  if (!input.allPages) {
    return paginateItems(input.rows, input.readControls);
  }

  const items = input.rows.slice(input.readControls.offset);
  return {
    items,
    page: {
      nextCursor: null,
      returnedCount: items.length,
    },
  };
}
