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
  const org = await input.db.query.organization.findFirst({
    columns: {
      id: true,
      slug: true,
      name: true,
    },
    where: eq(organization.slug, input.orgSlug),
  });

  if (!org) {
    return { kind: "not_found" };
  }

  if (typeof org.slug !== "string" || org.slug.trim().length === 0) {
    return { kind: "not_found" };
  }

  const accessibleOrg: AccessibleCliOrg = {
    id: org.id,
    name:
      typeof org.name === "string" && org.name.trim().length > 0
        ? org.name.trim()
        : org.slug.trim(),
    slug: org.slug.trim(),
  };

  const membership = await input.db.query.member.findFirst({
    columns: {
      id: true,
      role: true,
    },
    where: and(
      eq(member.userId, input.userId),
      eq(member.organizationId, accessibleOrg.id)
    ),
  });

  if (!membership) {
    return { kind: "forbidden" };
  }

  return {
    kind: "found",
    org: accessibleOrg,
    rawMembershipRole: membership.role,
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
