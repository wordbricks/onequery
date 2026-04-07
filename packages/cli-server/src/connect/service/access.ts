import { resolveCliSessionIdentity } from "../../auth/session-identity";
import { authorizeCliOrgAccess } from "../../authorization";
import type { AuthorizedCliOrgContext, CliAction } from "../../authorization";
import type { CliSessionIdentity } from "../../domain/workflows";
import {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
} from "../../observability";
import { runCliLoadOrgAccess } from "../../organization/effects";
import { finishCliOrgAccessWorkflow } from "../../organization/workflow";
import { throwCliConnectError } from "../error";
import type { CliHonoContext } from "./types";

export function requireCliSessionIdentity(
  session: CliSessionIdentity | null
): CliSessionIdentity {
  if (session) {
    return session;
  }

  throwCliConnectError({
    detail: "no authenticated session was found",
    key: "NOT_LOGGED_IN",
  });
}

export async function requireAuthenticatedCliSession(
  c: CliHonoContext
): Promise<CliSessionIdentity> {
  const session = await resolveCliSessionIdentity(
    c.var.storage,
    c.req.raw.headers
  );
  if (!session) {
    logCliEvent({
      details: buildCliRequestLogDetails(c),
      event: "auth.session_missing",
      level: "warn",
    });
    throwCliConnectError({
      detail: "no authenticated session was found",
      key: "NOT_LOGGED_IN",
    });
  }

  return session;
}

export async function requireAuthorizedCliOrg(input: {
  c: CliHonoContext;
  session: CliSessionIdentity;
  orgSlug: string;
  action: CliAction;
}): Promise<AuthorizedCliOrgContext> {
  const decision = finishCliOrgAccessWorkflow({
    access: await runCliLoadOrgAccess({
      db: input.c.var.storage.db,
      orgSlug: input.orgSlug,
      userId: input.session.user.id,
    }),
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
    interpretCliOrgAccessState(decision);
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
    throwCliConnectError({
      detail: `you do not have permission to ${input.action} in org "${input.orgSlug}"`,
      key: "FORBIDDEN",
    });
  }

  return authorization.context;
}

function interpretCliOrgAccessState(
  state: Parameters<
    typeof finishCliOrgAccessWorkflow
  >[0]["access"] extends never
    ? never
    : ReturnType<typeof finishCliOrgAccessWorkflow>
): never {
  if (state.kind === "org_not_found") {
    throwCliConnectError({
      key: "ORG_NOT_FOUND",
      detail: `no org named "${state.orgSlug}" exists`,
    });
  }

  if (state.kind === "forbidden") {
    throwCliConnectError({
      key: "FORBIDDEN",
      detail: `you do not have access to org "${state.orgSlug}"`,
    });
  }

  throw new Error(`unexpected cli org access state: ${state.kind}`);
}
