import type { SourceApiActorContext } from "@onequery/server/source-api";
import { Result } from "better-result";

import type { WorkflowActorSnapshot } from "../../../audit";
import type { AuthenticatedCliConnectRequestContext } from "../../context";
import type { CliServiceResult } from "../result";
import type { CliHonoContext } from "../types";

export type ResolvedSourceApiWorkflowContext = {
  actor: SourceApiActorContext;
  actorSnapshot: WorkflowActorSnapshot;
  c: CliHonoContext;
  organizationId: string;
  orgSlug: string;
  requestId: string;
};

export async function resolveSourceApiWorkflowContext(input: {
  action: "source_api.describe" | "source_api.execute";
  orgSlug: string;
  requestContext: AuthenticatedCliConnectRequestContext;
}): Promise<CliServiceResult<ResolvedSourceApiWorkflowContext>> {
  return Result.gen(async function* resolveSourceApiWorkflowContextFlow() {
    const authorizedOrg = yield* Result.await(
      input.requestContext.resolveAuthorizedOrg({
        action: input.action,
        orgSlug: input.orgSlug,
      })
    );

    return Result.ok({
      actor: {
        capabilities: authorizedOrg.capabilities,
        membershipRoles: authorizedOrg.membershipRoles,
        organizationId: authorizedOrg.org.id,
        organizationSlug: authorizedOrg.org.slug,
        requestId: input.requestContext.requestId,
        userId: input.requestContext.session.user.id,
      },
      actorSnapshot: {
        authMode: input.requestContext.session.authMode,
        email: input.requestContext.session.user.email,
        membershipRoles: [...authorizedOrg.membershipRoles],
        userId: input.requestContext.session.user.id,
      },
      c: input.requestContext.honoContext,
      organizationId: authorizedOrg.org.id,
      orgSlug: authorizedOrg.org.slug,
      requestId: input.requestContext.requestId,
    });
  });
}
