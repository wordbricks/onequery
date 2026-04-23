import { Result } from "better-result";

import { resolveQueryResultWindow } from "../../../query/result-window";
import { requireCliConnectRequestContext } from "../../context";
import type { CliQueryRequest } from "../../gen/onequery/cli/v1/query_pb";
import type { CliServiceResult } from "../result";
import type { CliServiceMethod } from "../types";
import { parseCliQueryRequest } from "./request";
import type { CliQueryServiceRequest, ResolvedCliQueryRequest } from "./types";

export async function resolveCliQueryRequestState<
  TRequest extends CliQueryServiceRequest,
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
    const query = parseCliQueryRequest(
      request.query as CliQueryRequest
    ) as NonNullable<TRequest["query"]>;

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
