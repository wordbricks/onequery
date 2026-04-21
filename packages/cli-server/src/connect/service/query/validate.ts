import { Result } from "better-result";

import { createCliConnectProblemForQueryPlanResult } from "../errors";
import type { CliResultServiceMethod } from "../result";
import { liftCliServiceMethod } from "../result";
import { resolveCliQueryRequestState } from "./context";
import { createCliQueryValidationDispatch } from "./dispatch";
import {
  logCliQueryValidationAccepted,
  logCliQueryValidationFailure,
} from "./logging";
import { buildQueryValidateResponse } from "./response";
import { runCliQueryValidationWorkflowResult } from "./workflow";

const handleValidateQueryImpl: CliResultServiceMethod<"validateQuery"> = async (
  request,
  context
) =>
  Result.gen(async function* handleValidateQueryFlow() {
    const resolved = yield* Result.await(
      resolveCliQueryRequestState(request, context)
    );
    const result = yield* Result.await(
      runCliQueryValidationWorkflowResult({
        actorSnapshot: {
          authMode: resolved.session.authMode,
          email: resolved.session.user.email,
          membershipRoles: [...resolved.authorizedOrg.membershipRoles],
          userId: resolved.session.user.id,
        },
        db: resolved.c.var.storage.db,
        dispatch: createCliQueryValidationDispatch(resolved.c),
        org: resolved.authorizedOrg.org,
        requestId: resolved.requestId,
        sourceName: request.sourceKey,
        sql: resolved.query.sql,
        timeoutMs: resolved.resultWindow.timeoutMs,
      })
    );

    if (result.kind !== "ready") {
      logCliQueryValidationFailure(resolved.c, request.sourceKey, result);
      return Result.err(createCliConnectProblemForQueryPlanResult(result));
    }

    logCliQueryValidationAccepted({
      c: resolved.c,
      provider: result.source.provider,
      sourceKey: request.sourceKey,
      truncated: result.truncated,
    });

    return Result.ok(
      buildQueryValidateResponse({
        request: {
          sql: result.normalizedSql,
          parameters: [],
          maxRows: resolved.resultWindow.maxRows,
          maxBytes: resolved.resultWindow.maxBytes,
          cellMaxChars: resolved.resultWindow.cellMaxChars,
          timeoutMs: resolved.resultWindow.timeoutMs,
        },
        normalizedSql: result.normalizedSql,
        declaredResultWindow: {
          maxRows: resolved.resultWindow.maxRows,
          maxBytes: resolved.resultWindow.maxBytes,
          cellMaxChars: resolved.resultWindow.cellMaxChars,
          timeoutMs: resolved.resultWindow.timeoutMs,
        },
        source: result.source,
        truncated: result.truncated,
      })
    );
  });

export const handleValidateQuery = liftCliServiceMethod(
  handleValidateQueryImpl
);
