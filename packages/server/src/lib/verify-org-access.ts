import { and, eq, getDatabaseSchema } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";

export type OrgAccessWithName =
  | { hasAccess: true; organizationName: string }
  | { hasAccess: false; reason: "forbidden" | "organization_not_found" };

type OrganizationNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: "organization_not_found" };

async function getOrganizationName(
  db: Database,
  organizationId: string
): Promise<OrganizationNameResult> {
  const { organization } = getDatabaseSchema(db);
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (!org) {
    return { ok: false, reason: "organization_not_found" };
  }

  return { name: org.name, ok: true };
}

/**
 * Verifies if a user can access an organization.
 * Users must be members of the organization.
 */
export async function verifyOrgAccess(
  db: Database,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { member } = getDatabaseSchema(db);
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId))
    )
    .limit(1);

  return Boolean(membership);
}

export async function verifyOrgAccessWithName(
  db: Database,
  userId: string,
  organizationId: string
): Promise<OrgAccessWithName> {
  const { member, organization } = getDatabaseSchema(db);
  const [membership] = await db
    .select({ name: organization.name })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId))
    )
    .limit(1);

  if (!membership) {
    const orgResult = await getOrganizationName(db, organizationId);
    if (!orgResult.ok) {
      return { hasAccess: false, reason: orgResult.reason };
    }

    return { hasAccess: false, reason: "forbidden" };
  }

  return { hasAccess: true, organizationName: membership.name };
}
