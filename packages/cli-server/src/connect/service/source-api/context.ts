import type { SourceApiActorContext } from "@onequery/server/source-api";
import { Result } from "better-result";

import type { WorkflowActorSnapshot } from "../../../audit";
import type { AuthorizedCliOrgContext } from "../../../authorization";
import type { CliLoadSourceEffectResult } from "../../../domain/effects";
import type { AuthenticatedCliConnectRequestContext } from "../../context";
import { resolveAuthorizedCliOrgFromAccess } from "../access";
import type { CliServiceResult } from "../result";
import type { CliHonoContext } from "../types";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  createEmptySourceApiWorkflowResourceCache,
  createSourceApiWorkflowResourceCacheFromLookup,
} from "./resource-cache";
import type { SourceApiWorkflowResourceCache } from "./resource-cache";

type ResolvedSourceApiWorkflowContext = {
  actor: SourceApiActorContext;
  actorSnapshot: WorkflowActorSnapshot;
  c: CliHonoContext;
  organizationId: string;
  orgSlug: string;
  requestId: string;
  resourceCache: SourceApiWorkflowResourceCache;
};

export async function resolveSourceApiWorkflowContext(input: {
  action: "source_api.describe" | "source_api.execute";
  dependencies: Pick<
    SourceApiServiceDependencies,
    "runCliLoadOrgAccessWithSource"
  >;
  orgSlug: string;
  requestContext: AuthenticatedCliConnectRequestContext;
  sourceKey: string;
}): Promise<CliServiceResult<ResolvedSourceApiWorkflowContext>> {
  return Result.gen(async function* resolveSourceApiWorkflowContextFlow() {
    const access = await input.dependencies.runCliLoadOrgAccessWithSource({
      db: input.requestContext.honoContext.var.storage.db,
      orgSlug: input.orgSlug,
      sourceKey: input.sourceKey,
      userId: input.requestContext.session.user.id,
    });
    const authorizedOrg = yield* resolveAuthorizedCliOrgFromAccess({
      access: access.access,
      action: input.action,
      c: input.requestContext.honoContext,
      orgSlug: input.orgSlug,
      session: input.requestContext.session,
    });

    return Result.ok(
      buildResolvedSourceApiWorkflowContext({
        authorizedOrg,
        c: input.requestContext.honoContext,
        requestId: input.requestContext.requestId,
        session: input.requestContext.session,
        sourceKey: input.sourceKey,
        sourceLookup: access.source,
      })
    );
  });
}

function buildResolvedSourceApiWorkflowContext(input: {
  authorizedOrg: AuthorizedCliOrgContext;
  c: CliHonoContext;
  requestId: string;
  session: AuthenticatedCliConnectRequestContext["session"];
  sourceKey: string;
  sourceLookup: CliLoadSourceEffectResult | null;
}): ResolvedSourceApiWorkflowContext {
  return {
    actor: buildSourceApiActor({
      authorizedOrg: input.authorizedOrg,
      requestId: input.requestId,
      session: input.session,
    }),
    actorSnapshot: buildSourceApiActorSnapshot({
      authorizedOrg: input.authorizedOrg,
      session: input.session,
    }),
    c: input.c,
    organizationId: input.authorizedOrg.org.id,
    orgSlug: input.authorizedOrg.org.slug,
    requestId: input.requestId,
    resourceCache:
      input.sourceLookup === null
        ? createEmptySourceApiWorkflowResourceCache()
        : createSourceApiWorkflowResourceCacheFromLookup({
            organizationId: input.authorizedOrg.org.id,
            sourceKey: input.sourceKey,
            sourceLookup: input.sourceLookup,
          }),
  };
}

export function buildSourceApiActor(input: {
  authorizedOrg: AuthorizedCliOrgContext;
  requestId: string;
  session: AuthenticatedCliConnectRequestContext["session"];
}): SourceApiActorContext {
  return {
    capabilities: input.authorizedOrg.capabilities,
    membershipRoles: input.authorizedOrg.membershipRoles,
    organizationId: input.authorizedOrg.org.id,
    organizationSlug: input.authorizedOrg.org.slug,
    requestId: input.requestId,
    userId: input.session.user.id,
  };
}

export function buildSourceApiActorSnapshot(input: {
  authorizedOrg: AuthorizedCliOrgContext;
  session: AuthenticatedCliConnectRequestContext["session"];
}): WorkflowActorSnapshot {
  return {
    authMode: input.session.authMode,
    email: input.session.user.email,
    membershipRoles: [...input.authorizedOrg.membershipRoles],
    userId: input.session.user.id,
  };
}
