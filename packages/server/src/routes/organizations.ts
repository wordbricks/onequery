import { zValidator } from "@hono/zod-validator";
import {
  AUDIT_FAMILIES,
  auditListQuerySchema,
} from "@onequery/audit-contracts/audit";
import {
  and,
  eq,
  member,
  organization,
  organizationProfiles,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { Hono } from "hono";
import { z } from "zod";

import {
  getAuditActionDetail,
  InvalidAuditCursorError,
  listAuditFeedPage,
} from "../audit/feed";
import {
  canReadOrganizationAudit,
  doesOrganizationMembershipGrantPermission,
  organizationPermissionChecks,
} from "../auth/organization-permissions";
import { verifyOrgAccess } from "../lib/verify-org-access";
import type { BetterAuthSessionVariables } from "../middleware/better-auth-session";
import { zodProblemHook } from "../problem-details/zod-problem-hook";

const OrganizationSlugParamsSchema = z.object({
  slug: z.string().min(1, "slug is required"),
});

const AuditActionParamsSchema = OrganizationSlugParamsSchema.extend({
  actionId: z.string().min(1, "action id is required"),
  family: z.enum(AUDIT_FAMILIES),
});

const UpdateOrgSettingsSchema = z
  .object({
    monthlyBudgetUsd: z.number().min(0).nullable().optional(),
  })
  .refine((body) => body.monthlyBudgetUsd !== undefined, {
    message: "At least one organization setting must be provided",
  });

function getOrganizationSettingsSelection() {
  return {
    monthlyBudgetUsd: organizationProfiles.monthlyBudgetUsd,
  };
}

async function findOrganizationMembershipBySlug(input: {
  db: Database;
  slug: string;
  userId: string;
}): Promise<
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "ok"; organizationId: string; rawRole: string | null }
> {
  const [org] = await input.db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, input.slug))
    .limit(1);

  if (!org) {
    return { kind: "not_found" };
  }

  const [membership] = await input.db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, org.id), eq(member.userId, input.userId))
    )
    .limit(1);

  if (!membership) {
    return { kind: "forbidden" };
  }

  return {
    kind: "ok",
    organizationId: org.id,
    rawRole: membership.role,
  };
}

/**
 * Organizations route for fetching organization data by slug.
 *
 * Access is membership-based: callers must belong to the target organization.
 *
 * @route GET /:slug
 */
export const organizationsRoute = new Hono<{
  Variables: BetterAuthSessionVariables;
}>()
  .get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const db = c.var.storage.db;
    const session = c.get("session");

    // Require authentication
    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Find organization by slug
    const [org] = await db
      .select({
        createdAt: organization.createdAt,
        id: organization.id,
        logo: organization.logo,
        name: organization.name,
        slug: organization.slug,
      })
      .from(organization)
      .where(eq(organization.slug, slug))
      .limit(1);

    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }

    // Check if user has access to the organization
    const hasAccess = await verifyOrgAccess(db, session.user.id, org.id);

    if (!hasAccess) {
      return c.json(
        { error: "Forbidden: Not a member of this organization" },
        403
      );
    }

    return c.json({ organization: org });
  })
  .get(
    "/:slug/audit",
    zValidator("param", OrganizationSlugParamsSchema, zodProblemHook()),
    zValidator("query", auditListQuerySchema, zodProblemHook()),
    async (c) => {
      const { slug } = c.req.valid("param");
      const query = c.req.valid("query");
      const db = c.var.storage.db;
      const session = c.get("session");

      if (!session?.user) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const membership = await findOrganizationMembershipBySlug({
        db,
        slug,
        userId: session.user.id,
      });

      if (membership.kind === "not_found") {
        return c.json({ error: "Organization not found" }, 404);
      }

      if (membership.kind === "forbidden") {
        return c.json(
          { error: "Forbidden: Not a member of this organization" },
          403
        );
      }

      if (!canReadOrganizationAudit({ rawRole: membership.rawRole })) {
        return c.json(
          { error: "Forbidden: You do not have permission to view audit" },
          403
        );
      }

      try {
        const response = await listAuditFeedPage({
          db,
          organizationId: membership.organizationId,
          query,
        });

        return c.json(response);
      } catch (error) {
        if (error instanceof InvalidAuditCursorError) {
          return c.json({ error: "Invalid cursor" }, 400);
        }

        throw error;
      }
    }
  )
  .get(
    "/:slug/audit/:family/:actionId",
    zValidator("param", AuditActionParamsSchema, zodProblemHook()),
    async (c) => {
      const { actionId, family, slug } = c.req.valid("param");
      const db = c.var.storage.db;
      const session = c.get("session");

      if (!session?.user) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const membership = await findOrganizationMembershipBySlug({
        db,
        slug,
        userId: session.user.id,
      });

      if (membership.kind === "not_found") {
        return c.json({ error: "Organization not found" }, 404);
      }

      if (membership.kind === "forbidden") {
        return c.json(
          { error: "Forbidden: Not a member of this organization" },
          403
        );
      }

      if (!canReadOrganizationAudit({ rawRole: membership.rawRole })) {
        return c.json(
          { error: "Forbidden: You do not have permission to view audit" },
          403
        );
      }

      const detail = await getAuditActionDetail({
        actionId,
        db,
        family,
        organizationId: membership.organizationId,
      });

      if (!detail) {
        return c.json({ error: "Audit action not found" }, 404);
      }

      return c.json(detail);
    }
  )
  .get("/:slug/settings", async (c) => {
    const slug = c.req.param("slug");
    const db = c.var.storage.db;
    const organizationSettingsSelection = getOrganizationSettingsSelection();
    const session = c.get("session");

    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Find organization by slug
    const [org] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug))
      .limit(1);

    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }

    const hasAccess = await verifyOrgAccess(db, session.user.id, org.id);

    if (!hasAccess) {
      return c.json(
        { error: "Forbidden: Not a member of this organization" },
        403
      );
    }

    // Get or create org profile
    const [profile] = await db
      .select(organizationSettingsSelection)
      .from(organizationProfiles)
      .where(eq(organizationProfiles.organizationId, org.id))
      .limit(1);

    if (profile) {
      return c.json({ settings: profile });
    }

    // Auto-create profile if missing so downstream settings updates always have a row.
    const [insertedProfile] = await db
      .insert(organizationProfiles)
      .values({
        organizationId: org.id,
      })
      .returning(organizationSettingsSelection);
    if (!insertedProfile) {
      return c.json({ error: "Organization profile not found" }, 404);
    }

    return c.json({ settings: insertedProfile });
  })
  .patch(
    "/:slug/settings",
    zValidator("json", UpdateOrgSettingsSchema, zodProblemHook()),
    async (c) => {
      const slug = c.req.param("slug");
      const body = c.req.valid("json");
      const db = c.var.storage.db;
      const organizationSettingsSelection = getOrganizationSettingsSelection();
      const session = c.get("session");

      if (!session?.user) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      // Find organization by slug
      const [org] = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.slug, slug))
        .limit(1);

      if (!org) {
        return c.json({ error: "Organization not found" }, 404);
      }

      const [membership] = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(member.organizationId, org.id)
          )
        )
        .limit(1);

      if (!membership) {
        return c.json(
          { error: "Forbidden: Not a member of this organization" },
          403
        );
      }

      // Comment: org settings writes should honor the same Better Auth
      // permission matrix as team-management mutations, including multi-role
      // memberships like `owner,admin`.
      const canManageSettings = doesOrganizationMembershipGrantPermission({
        permission: organizationPermissionChecks.organizationUpdate,
        rawRole: membership.role,
      });
      if (!canManageSettings) {
        return c.json(
          { error: "Forbidden: Only admins and owners can modify settings" },
          403
        );
      }

      // Check if profile exists
      const [existingProfile] = await db
        .select({ id: organizationProfiles.id })
        .from(organizationProfiles)
        .where(eq(organizationProfiles.organizationId, org.id))
        .limit(1);

      const profileUpdates = {
        ...(body.monthlyBudgetUsd !== undefined
          ? { monthlyBudgetUsd: body.monthlyBudgetUsd }
          : {}),
      };

      const [updatedProfile] = existingProfile
        ? await db
            .update(organizationProfiles)
            .set(profileUpdates)
            .where(eq(organizationProfiles.organizationId, org.id))
            .returning(organizationSettingsSelection)
        : await db
            .insert(organizationProfiles)
            .values({
              organizationId: org.id,
              ...(body.monthlyBudgetUsd !== undefined
                ? { monthlyBudgetUsd: body.monthlyBudgetUsd }
                : {}),
            })
            .returning(organizationSettingsSelection);
      if (!updatedProfile) {
        return c.json({ error: "Organization profile not found" }, 404);
      }

      return c.json({ settings: updatedProfile });
    }
  );
