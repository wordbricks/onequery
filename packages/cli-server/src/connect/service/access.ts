import { Result } from "better-result";

import { resolveCliSessionIdentity } from "../../auth/session-identity";
import type { ResolveCliSessionIdentityOptions } from "../../auth/session-identity";
import { authorizeCliOrgAccess } from "../../authorization";
import type { AuthorizedCliOrgContext, CliAction } from "../../authorization";
import type {
  CliOrgAccessResult,
  CliSessionIdentity,
} from "../../domain/workflows";
import {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
} from "../../observability";
import { runCliLoadOrgAccess } from "../../organization/effects";
import { finishCliOrgAccessWorkflow } from "../../organization/workflow";
import type { CliServiceResult } from "./result";
import { cliServiceErr } from "./result";
import type { CliHonoContext } from "./types";

export function resolveCliSessionIdentityResult(
  session: CliSessionIdentity | null
): CliServiceResult<CliSessionIdentity> {
  if (session) {
    return Result.ok(session);
  }

  return cliServiceErr({
    detail: "no authenticated session was found",
    key: "NOT_LOGGED_IN",
  });
}

export async function resolveAuthenticatedCliSession(
  c: CliHonoContext,
  options: ResolveCliSessionIdentityOptions = {}
): Promise<CliServiceResult<CliSessionIdentity>> {
  const session = await resolveCliSessionIdentity(
    c.var.storage,
    c.req.raw.headers,
    options
  );
  if (!session) {
    logCliEvent({
      details: buildCliRequestLogDetails(c),
      event: "auth.session_missing",
      level: "warn",
    });
    return cliServiceErr({
      detail: "no authenticated session was found",
      key: "NOT_LOGGED_IN",
    });
  }

  return Result.ok(session);
}

export async function resolveAuthorizedCliOrg(input: {
  c: CliHonoContext;
  session: CliSessionIdentity;
  orgSlug: string;
  action: CliAction;
}): Promise<CliServiceResult<AuthorizedCliOrgContext>> {
  return resolveAuthorizedCliOrgFromAccess({
    access: await runCliLoadOrgAccess({
      db: input.c.var.storage.db,
      orgSlug: input.orgSlug,
      userId: input.session.user.id,
    }),
    action: input.action,
    c: input.c,
    orgSlug: input.orgSlug,
    session: input.session,
  });
}

export function resolveAuthorizedCliOrgFromAccess(input: {
  access: CliOrgAccessResult;
  action: CliAction;
  c: CliHonoContext;
  orgSlug: string;
  session: CliSessionIdentity;
}): CliServiceResult<AuthorizedCliOrgContext> {
  const decision = finishCliOrgAccessWorkflow({
    access: input.access,
    orgSlug: input.orgSlug,
  });

  if (decision.kind !== "allowed") {
    recordCliCounterMetric({
      name: "cli.org.resolution_failure_total",
      tags: {
        reason: decision.kind,
      },
    });
    logCliEvent({
      details: buildCliRequestLogDetails(input.c, {
        action: input.action,
        orgSlug: input.orgSlug,
        reason: decision.kind,
        userId: input.session.user.id,
      }),
      event: "org.access_denied",
      level: "warn",
    });
    return interpretCliOrgAccessState(decision);
  }

  const authorization = authorizeCliOrgAccess({
    action: input.action,
    org: decision.org,
    rawMembershipRole: decision.rawMembershipRole,
  });

  if (authorization.kind !== "allowed") {
    recordCliCounterMetric({
      name: "cli.org.authorization_failure_total",
      tags: {
        action: input.action,
        reason: authorization.reason,
      },
    });
    logCliEvent({
      details: buildCliRequestLogDetails(input.c, {
        action: input.action,
        orgSlug: input.orgSlug,
        reason: authorization.reason,
        roles: authorization.authorization.membershipRoles,
        userId: input.session.user.id,
      }),
      event: "org.action_forbidden",
      level: "warn",
    });
    return cliServiceErr({
      detail: `you do not have permission to ${input.action} in org "${input.orgSlug}"`,
      key: "FORBIDDEN",
      resource: {
        description: `organization access does not allow ${input.action}`,
        name: input.orgSlug,
        type: "onequery.cli.organization",
      },
    });
  }

  return Result.ok(authorization.context);
}

function interpretCliOrgAccessState(
  state: Parameters<
    typeof finishCliOrgAccessWorkflow
  >[0]["access"] extends never
    ? never
    : ReturnType<typeof finishCliOrgAccessWorkflow>
): CliServiceResult<never> {
  if (state.kind === "org_not_found") {
    return cliServiceErr({
      key: "ORG_NOT_FOUND",
      detail: `no org named "${state.orgSlug}" exists`,
      resource: {
        description: "organization was not found",
        name: state.orgSlug,
        type: "onequery.cli.organization",
      },
    });
  }

  if (state.kind === "forbidden") {
    return cliServiceErr({
      key: "FORBIDDEN",
      detail: `you do not have access to org "${state.orgSlug}"`,
      resource: {
        description: "organization access is forbidden",
        name: state.orgSlug,
        type: "onequery.cli.organization",
      },
    });
  }

  throw new Error(`unexpected cli org access state: ${state.kind}`);
}
