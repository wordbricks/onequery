import { zValidator } from "@hono/zod-validator";
import { auditListQuerySchema } from "@onequery/contracts/audit";
import {
  and,
  desc,
  eq,
  getDatabaseSchema,
  lt,
  or,
  sql,
} from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { Hono } from "hono";
import { z } from "zod";

import {
  canReadOrganizationAudit,
  doesOrganizationMembershipGrantPermission,
  organizationPermissionChecks,
} from "../auth/organization-permissions";
import { verifyOrgAccess } from "../lib/verify-org-access";
import type { SessionVariables } from "../middleware/session";
import { zodProblemHook } from "../problem-details/zod-problem-hook";

const OrganizationSlugParamsSchema = z.object({
  slug: z.string().min(1, "slug is required"),
});

const UpdateOrgSettingsSchema = z
  .object({
    monthlyBudgetUsd: z.number().min(0).nullable().optional(),
  })
  .refine((body) => body.monthlyBudgetUsd !== undefined, {
    message: "At least one organization setting must be provided",
  });

type AuditCursor = {
  id: string;
  occurredAt: Date;
};

function getOrganizationSettingsSelection(db: Database) {
  const { organizationProfiles } = getDatabaseSchema(db);
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
  const { member, organization } = getDatabaseSchema(input.db);

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

function escapeLikePattern(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function buildCaseInsensitiveContains(column: unknown, value: string) {
  const pattern = `%${escapeLikePattern(value.toLowerCase())}%`;
  return sql`lower(coalesce(${column}, '')) like ${pattern} escape '\\'`;
}

function decodeAuditCursor(cursor: string): AuditCursor | null {
  const separatorIndex = cursor.indexOf("|");
  if (separatorIndex <= 0 || separatorIndex === cursor.length - 1) {
    return null;
  }

  const occurredAt = new Date(cursor.slice(0, separatorIndex));
  const id = cursor.slice(separatorIndex + 1);

  if (Number.isNaN(occurredAt.getTime()) || id.length === 0) {
    return null;
  }

  return { id, occurredAt };
}

function encodeAuditCursor(input: AuditCursor): string {
  return `${input.occurredAt.toISOString()}|${input.id}`;
}

/**
 * Organizations route for fetching organization data by slug.
 *
 * Access is membership-based: callers must belong to the target organization.
 *
 * @route GET /:slug
 */
export const organizationsRoute = new Hono<{
  Variables: SessionVariables;
}>()
  .get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const db = c.var.storage.db;
    const { organization } = getDatabaseSchema(db);
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

      const { cliQueryActionEvents, cliQueryActions } = getDatabaseSchema(db);
      const conditions = [
        eq(cliQueryActions.organizationId, membership.organizationId),
      ];

      if (query.status) {
        conditions.push(eq(cliQueryActions.status, query.status));
      }

      if (query.actionType) {
        conditions.push(eq(cliQueryActions.actionType, query.actionType));
      }

      if (query.sourceKey) {
        conditions.push(eq(cliQueryActions.sourceKey, query.sourceKey));
      }

      if (query.q) {
        const searchCondition = or(
          buildCaseInsensitiveContains(cliQueryActions.actorEmail, query.q),
          buildCaseInsensitiveContains(cliQueryActions.sourceKey, query.q),
          buildCaseInsensitiveContains(cliQueryActions.sql, query.q)
        );

        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }

      if (query.cursor) {
        const cursor = decodeAuditCursor(query.cursor);
        if (!cursor) {
          return c.json({ error: "Invalid cursor" }, 400);
        }

        const cursorCondition = or(
          lt(cliQueryActions.lastEventAt, cursor.occurredAt),
          and(
            eq(cliQueryActions.lastEventAt, cursor.occurredAt),
            lt(cliQueryActions.id, cursor.id)
          )
        );

        if (cursorCondition) {
          conditions.push(cursorCondition);
        }
      }

      // Comment: Audit v1 is intentionally action-history, not raw event
      // history; reading the aggregate row plus its last event keeps the API
      // stable while the broader audit model is still narrow.
      const rows = await db
        .select({
          actionType: cliQueryActions.actionType,
          actorEmail: cliQueryActions.actorEmail,
          actorMembershipRoles: cliQueryActions.actorMembershipRoles,
          actorUserId: cliQueryActions.actorUserId,
          elapsedMs: cliQueryActions.elapsedMs,
          errorDetail: cliQueryActions.errorDetail,
          errorHint: cliQueryActions.errorHint,
          id: cliQueryActions.id,
          lastEventType: cliQueryActionEvents.eventType,
          normalizedSql: cliQueryActions.normalizedSql,
          normalizedSqlChanged: cliQueryActions.normalizedSqlChanged,
          occurredAt: cliQueryActions.lastEventAt,
          provider: cliQueryActions.provider,
          requestId: cliQueryActions.requestId,
          retryable: cliQueryActions.retryable,
          rowCount: cliQueryActions.rowCount,
          sourceId: cliQueryActions.sourceId,
          sourceKey: cliQueryActions.sourceKey,
          sql: cliQueryActions.sql,
          stage: cliQueryActions.stage,
          status: cliQueryActions.status,
          usagePersistenceStatus: cliQueryActions.usagePersistenceStatus,
        })
        .from(cliQueryActions)
        .innerJoin(
          cliQueryActionEvents,
          and(
            eq(cliQueryActionEvents.queryActionId, cliQueryActions.id),
            eq(cliQueryActionEvents.id, cliQueryActions.lastEventId)
          )
        )
        .where(and(...conditions))
        .orderBy(desc(cliQueryActions.lastEventAt), desc(cliQueryActions.id))
        .limit(query.limit + 1);

      const pageRows = rows.slice(0, query.limit);
      const lastRow = pageRows.at(-1);

      return c.json({
        families: ["cli_query_action"] as const,
        items: pageRows.map((row) => ({
          action: {
            provider: row.provider ?? null,
            requestId: row.requestId,
            sourceId: row.sourceId ?? null,
            sourceKey: row.sourceKey,
            type: row.actionType,
          },
          actor: {
            email: row.actorEmail,
            membershipRoles: row.actorMembershipRoles,
            userId: row.actorUserId,
          },
          error:
            row.errorDetail || row.errorHint
              ? {
                  detail: row.errorDetail ?? null,
                  hint: row.errorHint ?? null,
                }
              : null,
          family: "cli_query_action" as const,
          id: row.id,
          metrics: {
            elapsedMs: row.elapsedMs ?? null,
            retryable: row.retryable ?? null,
            rowCount: row.rowCount ?? null,
          },
          occurredAt: row.occurredAt,
          query: {
            normalizedSql: row.normalizedSql ?? null,
            normalizedSqlChanged: row.normalizedSqlChanged,
            sql: row.sql,
          },
          state: {
            lastEventType: row.lastEventType,
            stage: row.stage,
            status: row.status,
            usagePersistenceStatus: row.usagePersistenceStatus,
          },
        })),
        nextCursor:
          rows.length > query.limit && lastRow
            ? encodeAuditCursor({
                id: lastRow.id,
                occurredAt: lastRow.occurredAt,
              })
            : null,
      });
    }
  )
  .get("/:slug/settings", async (c) => {
    const slug = c.req.param("slug");
    const db = c.var.storage.db;
    const { organization, organizationProfiles } = getDatabaseSchema(db);
    const organizationSettingsSelection = getOrganizationSettingsSelection(db);
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
      const { member, organization, organizationProfiles } =
        getDatabaseSchema(db);
      const organizationSettingsSelection =
        getOrganizationSettingsSelection(db);
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
