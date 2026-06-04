import {
  and,
  dataSources,
  eq,
  member,
  organization,
} from "@onequery/db/server";
import type { Database, ProviderType } from "@onequery/db/server";

import type { CliLoadSourceEffectResult } from "../domain/effects";
import type {
  AccessibleCliOrg,
  CliOrgAccessResult,
  CliOrgSummary,
} from "../domain/workflows";
import { createCliQuerySourceRecord } from "../source/model";

type CliOrgAccessWithSourceResult = {
  access: CliOrgAccessResult;
  source: CliLoadSourceEffectResult | null;
};

type CliOrgAccessRow = {
  membershipId: string | null;
  membershipRole: string | null;
  orgId: string;
  orgName: string | null;
  orgSlug: string | null;
};

export async function runCliLoadOrgAccess(input: {
  db: Database;
  orgSlug: string;
  userId: string;
}): Promise<CliOrgAccessResult> {
  const [row] = await input.db
    .select({
      orgId: organization.id,
      orgName: organization.name,
      orgSlug: organization.slug,
      membershipId: member.id,
      membershipRole: member.role,
    })
    .from(organization)
    .leftJoin(
      member,
      and(
        eq(member.organizationId, organization.id),
        eq(member.userId, input.userId)
      )
    )
    .where(eq(organization.slug, input.orgSlug))
    .limit(1);

  return toCliOrgAccessResult(row);
}

export async function runCliLoadOrgAccessWithSource(input: {
  db: Database;
  orgSlug: string;
  sourceKey: string;
  sourceProvider: ProviderType;
  userId: string;
}): Promise<CliOrgAccessWithSourceResult> {
  const [row] = await input.db
    .select({
      orgId: organization.id,
      orgName: organization.name,
      orgSlug: organization.slug,
      membershipId: member.id,
      membershipRole: member.role,
    })
    .from(organization)
    .leftJoin(
      member,
      and(
        eq(member.organizationId, organization.id),
        eq(member.userId, input.userId)
      )
    )
    .where(eq(organization.slug, input.orgSlug))
    .limit(1);

  const access = toCliOrgAccessResult(row);
  if (access.kind !== "found") {
    return {
      access,
      source: null,
    };
  }

  const source = await loadCliSourceBySourceKey({
    db: input.db,
    organizationId: access.org.id,
    sourceKey: input.sourceKey,
    sourceProvider: input.sourceProvider,
  });

  return {
    access,
    source,
  };
}

export async function runCliListVisibleOrgs(input: {
  db: Database;
  userId: string;
}): Promise<CliOrgSummary[]> {
  const rawRows = await input.db
    .select({ name: organization.name, slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, input.userId));

  const orgs: CliOrgSummary[] = [];
  for (const row of rawRows) {
    if (typeof row.slug !== "string" || row.slug.trim().length === 0) {
      continue;
    }

    const slug = row.slug.trim();
    const name =
      typeof row.name === "string" && row.name.trim().length > 0
        ? row.name.trim()
        : slug;

    orgs.push({ name, slug });
  }

  orgs.sort((left, right) => {
    const bySlug = left.slug.localeCompare(right.slug);
    if (bySlug !== 0) {
      return bySlug;
    }

    return left.name.localeCompare(right.name);
  });

  return orgs;
}

function toCliOrgAccessResult(
  row: CliOrgAccessRow | undefined
): CliOrgAccessResult {
  if (row === undefined) {
    return { kind: "not_found" };
  }

  if (row.orgSlug === null || row.orgSlug.trim().length === 0) {
    return { kind: "not_found" };
  }

  const accessibleOrg: AccessibleCliOrg = {
    id: row.orgId,
    name:
      row.orgName !== null && row.orgName.trim().length > 0
        ? row.orgName.trim()
        : row.orgSlug.trim(),
    slug: row.orgSlug.trim(),
  };

  if (row.membershipId === null || row.membershipRole === null) {
    return { kind: "forbidden" };
  }

  return {
    kind: "found",
    org: accessibleOrg,
    rawMembershipRole: row.membershipRole,
  };
}

async function loadCliSourceBySourceKey(input: {
  db: Database;
  organizationId: string;
  sourceKey: string;
  sourceProvider: ProviderType;
}): Promise<CliLoadSourceEffectResult> {
  const rows = await input.db.query.dataSources.findMany({
    columns: {
      id: true,
      name: true,
      organizationId: true,
      provider: true,
      status: true,
      credentialsEncrypted: true,
      credentialsIv: true,
    },
    where: and(
      eq(dataSources.organizationId, input.organizationId),
      eq(dataSources.provider, input.sourceProvider)
    ),
  });

  const source = rows
    .map((candidate) => createCliQuerySourceRecord(candidate))
    .find((candidate) => candidate?.sourceKey === input.sourceKey);

  if (!source) {
    return {
      kind: "not_found",
    };
  }

  return {
    kind: "found",
    source,
  };
}
