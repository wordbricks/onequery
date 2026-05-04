import type { CliQueryRequest } from "@onequery/proto-cli/cli/v1/query_pb";
import { Result } from "better-result";

import { runCliLoadOrgAccessWithSource } from "../../../organization/effects";
import { resolveQueryResultWindow } from "../../../query/result-window";
import { requireCliConnectRequestContext } from "../../context";
import { resolveAuthorizedCliOrgFromAccess } from "../access";
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
    const access = await runCliLoadOrgAccessWithSource({
      db: requestContext.honoContext.var.storage.db,
      orgSlug: request.orgSlug,
      sourceKey: request.sourceKey,
      userId: session.user.id,
    });
    const authorizedOrg = yield* resolveAuthorizedCliOrgFromAccess({
      access: access.access,
      action: "query.execute",
      c: requestContext.honoContext,
      orgSlug: request.orgSlug,
      session,
    });
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
      sourceLookup: access.source,
    });
  });
}
