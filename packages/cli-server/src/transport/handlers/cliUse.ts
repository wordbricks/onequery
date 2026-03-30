import { and, eq, getDatabaseSchema } from "@onequery/db/server";
import { createFactory } from "hono/factory";

import type { CliUseContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import { CliUseQueryParams, CliUseResponse } from "../../../generated/cli.zod";
import type { CliRouteEnv } from "../../app";
import { resolveCliSessionIdentity } from "../../auth/session-identity";
import { authorizeCliOrgAccess } from "../../authorization";
import { buildCliRequestLogDetails, logCliEvent } from "../../observability";
import { runCliLoadOrgAccess } from "../../organization/effects";
import { finishCliOrgAccessWorkflow } from "../../organization/workflow";
import {
  getCliUseIntegrationRequiredSkill,
  getCliUseSkill,
} from "../../use/skills";
import type { CliUseSource } from "../../use/skills";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";

const factory = createFactory();
const CLI_USE_ORG_HEADER = "x-onequery-org-slug";

export const cliUseHandlers = factory.createHandlers(
  zValidator(
    "query",
    CliUseQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid use request",
      defaultStage: "resolve_source",
      fieldStages: {
        source: "resolve_source",
      },
      hint: "choose one of the supported use sources and retry",
    })
  ),
  zValidator("response", CliUseResponse),
  async (c: CliUseContext<CliRouteEnv>) => {
    const { source } = c.req.valid("query");
    const skill = await resolveCliUseSkill(c, source);

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: skill.orgSlug,
        source,
      }),
      event: skill.event,
      level: "info",
    });

    return c.json(
      buildCliSuccessEnvelope({
        data: skill.payload,
        requestId: c.var.requestId,
      }),
      200
    );
  }
);

async function resolveCliUseSkill(
  c: CliUseContext<CliRouteEnv>,
  source: CliUseSource
) {
  const defaultSkill = getCliUseSkill(source);
  const org = await resolveCliUseOrg(c);

  if (!org) {
    return {
      event: "use.skill.resolved",
      orgSlug: null,
      payload: defaultSkill,
    } as const;
  }

  const db = c.var.storage.db;
  const { dataSources } = getDatabaseSchema(db);
  const connectedSource = await db.query.dataSources.findFirst({
    where: and(
      eq(dataSources.organizationId, org.id),
      eq(dataSources.provider, source),
      eq(dataSources.status, "active")
    ),
  });

  if (connectedSource) {
    return {
      event: "use.skill.resolved",
      orgSlug: org.slug,
      payload: defaultSkill,
    } as const;
  }

  return {
    event: "use.skill.integration_required",
    orgSlug: org.slug,
    payload: getCliUseIntegrationRequiredSkill({ orgSlug: org.slug, source }),
  } as const;
}

async function resolveCliUseOrg(c: CliUseContext<CliRouteEnv>) {
  const session = await resolveCliSessionIdentity(
    c.var.storage,
    c.req.raw.headers
  );
  if (!session) {
    return null;
  }

  const requestedOrgSlug = c.req.header(CLI_USE_ORG_HEADER)?.trim();
  const orgSlug =
    requestedOrgSlug && requestedOrgSlug.length > 0
      ? requestedOrgSlug
      : session.activeOrg?.trim();
  if (!orgSlug) {
    return null;
  }

  const decision = finishCliOrgAccessWorkflow({
    access: await runCliLoadOrgAccess({
      db: c.var.storage.db,
      orgSlug,
      userId: session.user.id,
    }),
    orgSlug,
  });
  if (decision.kind !== "allowed") {
    return null;
  }

  const authorization = authorizeCliOrgAccess({
    action: "source.list",
    org: decision.org,
    rawMembershipRole: decision.rawMembershipRole,
  });

  return authorization.kind === "allowed" ? authorization.context.org : null;
}
