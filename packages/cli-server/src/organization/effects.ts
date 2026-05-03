import { and, eq, member, organization } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";

import type {
  AccessibleCliOrg,
  CliOrgAccessResult,
  CliOrgSummary,
} from "../domain/workflows";

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
