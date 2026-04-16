import { Result } from "better-result";

import { resolveQueryResultWindow } from "../../../query/result-window";
import { requireCliConnectRequestContext } from "../../context";
import type { CliServiceResult } from "../result";
import type { CliServiceMethod } from "../types";
import type { ResolvedCliQueryRequest } from "./types";

type CliQueryRequest = {
  orgSlug: string;
  sourceKey: string;
  query?: {
    cellMaxChars?: number;
    maxBytes?: number;
    maxRows?: number;
    sql: string;
    timeoutMs?: number;
  };
};

export async function resolveCliQueryRequestState<
  TRequest extends CliQueryRequest,
>(
  request: TRequest,
  context: Parameters<CliServiceMethod<"validateQuery">>[1]
): Promise<CliServiceResult<ResolvedCliQueryRequest<TRequest>>> {
  return Result.gen(async function* resolveCliQueryRequestStateFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const session = yield* Result.await(requestContext.resolveSession());
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action: "query.execute",
        orgSlug: request.orgSlug,
        session,
      })
    );
    const query = request.query as NonNullable<TRequest["query"]>;

    return Result.ok({
      authorizedOrg,
      c: requestContext.honoContext,
      query,
      requestId: requestContext.requestId,
      resultWindow: resolveQueryResultWindow(query),
      session,
    });
  });
}
