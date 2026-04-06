import { and, eq, getDatabaseSchema } from "@onequery/db/server";

import { resolveCliSessionIdentity } from "../../auth/session-identity";
import { authorizeCliOrgAccess } from "../../authorization";
import { buildCliRequestLogDetails, logCliEvent } from "../../observability";
import { runCliLoadOrgAccess } from "../../organization/effects";
import { finishCliOrgAccessWorkflow } from "../../organization/workflow";
import {
  getCliUseIntegrationRequiredSkill,
  getCliUseSkill,
} from "../../use/skills";
import type { CliUseSource as CliUseSkillSource } from "../../use/skills";
import { requireCliConnectHonoContext } from "../context";
import {
  fromCliUseSource,
  toCliContentFormat,
  toCliUseSourceEnum,
} from "./conversions";
import type { CliHonoContext, CliServiceMethod } from "./types";

export const handleUse: CliServiceMethod<"use"> = async (request, context) => {
  const c = requireCliConnectHonoContext(context);
  const source = fromCliUseSource(request.source);
  const skill = await resolveCliUseSkill({
    c,
    source,
    orgSlug: request.orgSlug,
  });

  logCliEvent({
    details: buildCliRequestLogDetails(c, {
      orgSlug: skill.orgSlug,
      source,
    }),
    event: skill.event,
    level: "info",
  });

  return {
    source: toCliUseSourceEnum(skill.payload.source),
    title: skill.payload.title,
    description: skill.payload.description,
    format: toCliContentFormat(skill.payload.format),
    content: skill.payload.content,
  };
};

async function resolveCliUseSkill(input: {
  c: CliHonoContext;
  source: CliUseSkillSource;
  orgSlug?: string;
}) {
  const defaultSkill = getCliUseSkill(input.source);
  const org = await resolveCliUseOrg(input.c, input.orgSlug);

  if (!org) {
    return {
      event: "use.skill.resolved",
      orgSlug: null,
      payload: defaultSkill,
    } as const;
  }

  const db = input.c.var.storage.db;
  const { dataSources } = getDatabaseSchema(db);
  const connectedSource = await db.query.dataSources.findFirst({
    where: and(
      eq(dataSources.organizationId, org.id),
      eq(dataSources.provider, input.source),
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
    payload: getCliUseIntegrationRequiredSkill({
      orgSlug: org.slug,
      source: input.source,
    }),
  } as const;
}

async function resolveCliUseOrg(c: CliHonoContext, requestedOrgSlug?: string) {
  const session = await resolveCliSessionIdentity(
    c.var.storage,
    c.req.raw.headers
  );
  if (!session) {
    return null;
  }

  const orgSlug = requestedOrgSlug?.trim() || session.activeOrg?.trim();
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
