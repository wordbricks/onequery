import { createMiddleware } from "hono/factory";

import type {
  CliOrgRouteVariables,
  CliRouteEnv,
  CliSessionRouteVariables,
} from "../app";
import { authorizeCliOrgAccess } from "../authorization";
import type { CliAction } from "../authorization";
import type { CliOrgAccessDecision } from "../domain/workflows";
import { throwCliProblem } from "../error";
import {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
} from "../observability";
import { runCliLoadOrgAccess } from "./effects";
import { finishCliOrgAccessWorkflow } from "./workflow";

export const cliDbMiddleware = createMiddleware<
  CliRouteEnv<CliSessionRouteVariables & Pick<CliOrgRouteVariables, "db">>
>(async (c, next) => {
  c.set("db", c.var.storage.db);
  await next();
});

type CliOrgAuthorizationInput = {
  out: {
    param: {
      orgSlug: string;
    };
  };
};

export function createCliOrgAuthorizationMiddleware(action: CliAction) {
  return createMiddleware<
    CliRouteEnv<CliOrgRouteVariables>,
    string,
    CliOrgAuthorizationInput
  >(async (c, next) => {
    // Comment: cliSessionMiddleware and the route-level param validator
    // already guarantee an authenticated session and a validated orgSlug
    // before this middleware runs, so org access resolution can
    // start at the DB lookup.
    const session = c.var.session;
    const { orgSlug } = c.req.valid("param");

    const decision = finishCliOrgAccessWorkflow({
      access: await runCliLoadOrgAccess({
        db: c.var.db,
        orgSlug,
        userId: session.user.id,
      }),
      orgSlug,
    });

    if (decision.kind !== "allowed") {
      recordCliCounterMetric({
        name: "cli.org.resolution_failure_total",
        tags: {
          reason: decision.kind,
        },
      });
      logCliEvent({
        details: buildCliRequestLogDetails(c, {
          action,
          orgSlug,
          reason: decision.kind,
          userId: session.user.id,
        }),
        event: "org.access_denied",
        level: "warn",
      });
      interpretCliOrgAccessState(decision);
    }

    const authorization = authorizeCliOrgAccess({
      action,
      org: decision.org,
      rawMembershipRole: decision.rawMembershipRole,
    });

    if (authorization.kind !== "allowed") {
      recordCliCounterMetric({
        name: "cli.org.authorization_failure_total",
        tags: {
          action,
          reason: authorization.reason,
        },
      });
      logCliEvent({
        details: buildCliRequestLogDetails(c, {
          action,
          orgSlug,
          reason: authorization.reason,
          roles: authorization.authorization.membershipRoles,
          userId: session.user.id,
        }),
        event: "org.action_forbidden",
        level: "warn",
      });
      throwCliProblem({
        detail: `you do not have permission to ${action} in org "${orgSlug}"`,
        hint: "verify your org role and retry",
        key: "FORBIDDEN",
      });
    }

    c.set("authorizedOrg", authorization.context);
    await next();
  });
}

function interpretCliOrgAccessState(state: CliOrgAccessDecision): never {
  switch (state.kind) {
    case "org_not_found": {
      return throwCliProblem({
        key: "ORG_NOT_FOUND",
        detail: `no org named "${state.orgSlug}" exists`,
      });
    }
    case "forbidden": {
      return throwCliProblem({
        key: "FORBIDDEN",
        detail: `you do not have access to org "${state.orgSlug}"`,
      });
    }
    case "allowed": {
      throw new Error(`unexpected cli org access state: ${state.kind}`);
    }
  }
}
