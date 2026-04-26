import { and, eq, member, organization } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";

export type OrgAccessWithName =
  | { hasAccess: true; organizationName: string }
  | { hasAccess: false; reason: "forbidden" | "organization_not_found" };

class OrganizationNotFoundError extends TaggedError(
  "OrganizationNotFoundError"
)<{
  message: string;
  organizationId: string;
}>() {}

async function getOrganizationName(
  db: Database,
  organizationId: string
): Promise<Result<string, OrganizationNotFoundError>> {
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (!org) {
    return Result.err(
      new OrganizationNotFoundError({
        message: `Organization ${organizationId} not found`,
        organizationId,
      })
    );
  }

  return Result.ok(org.name);
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
    if (orgResult.isErr()) {
      return { hasAccess: false, reason: "organization_not_found" };
    }

    return { hasAccess: false, reason: "forbidden" };
  }

  return { hasAccess: true, organizationName: membership.name };
}
