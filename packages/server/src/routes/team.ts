import { zValidator } from "@hono/zod-validator";
import { and, eq, member } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { Hono } from "hono";
import { z } from "zod";

import {
  doesOrganizationMembershipGrantPermission,
  organizationPermissionChecks,
} from "../auth/organization-permissions";
import type { OrganizationPermissionCheck } from "../auth/organization-permissions";
import type { SessionVariables } from "../middleware/session";
import { zodProblemHook } from "../problem-details/zod-problem-hook";

const TeamRoleSchema = z.enum(["owner", "admin", "member"]);
const TeamRoleSelectionSchema = z.union([
  TeamRoleSchema,
  z.array(TeamRoleSchema).min(1),
]);

const OrganizationParamsSchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
});

const MemberParamsSchema = OrganizationParamsSchema.extend({
  memberId: z.string().min(1, "memberId is required"),
});

const InvitationParamsSchema = OrganizationParamsSchema.extend({
  invitationId: z.string().min(1, "invitationId is required"),
});

const CreateInvitationBodySchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  role: TeamRoleSelectionSchema,
});

const UpdateMemberRoleBodySchema = z.object({
  role: TeamRoleSelectionSchema,
});

type TeamPermissionResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

async function findOrganizationMembership(
  db: Database,
  userId: string,
  organizationId: string
) {
  return db.query.member.findFirst({
    columns: { id: true, role: true },
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });
}

async function requireTeamPermission(input: {
  db: Database;
  organizationId: string;
  permission: OrganizationPermissionCheck;
  session: SessionVariables["session"];
}): Promise<TeamPermissionResult> {
  const { db, organizationId, permission, session } = input;

  if (!session?.user) {
    return { error: "Unauthorized", ok: false, status: 401 };
  }

  const membership = await findOrganizationMembership(
    db,
    session.user.id,
    organizationId
  );

  if (
    membership &&
    doesOrganizationMembershipGrantPermission({
      permission,
      rawRole: membership.role,
    })
  ) {
    return { ok: true };
  }

  return { error: "Forbidden", ok: false, status: 403 };
}

export const teamRoute = new Hono<{
  Variables: SessionVariables;
}>()
  .post(
    "/organizations/:organizationId/invitations",
    zValidator("param", OrganizationParamsSchema, zodProblemHook()),
    zValidator("json", CreateInvitationBodySchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("param");
      const { email, role } = c.req.valid("json");
      const session = c.get("session");
      const db = c.var.storage.db;
      const access = await requireTeamPermission({
        db,
        organizationId,
        permission: organizationPermissionChecks.invitationCreate,
        session,
      });

      if (!access.ok) {
        return c.json({ error: access.error }, access.status);
      }

      const auth = c.var.storage.auth;
      return auth.api.createInvitation({
        asResponse: true,
        body: {
          email,
          organizationId,
          role,
          // Comment: manual invite links may already be shared out-of-band, so
          // re-invites should keep the same pending invitation and extend expiry.
          resend: true,
        },
        headers: c.req.raw.headers,
      });
    }
  )
  .delete(
    "/organizations/:organizationId/invitations/:invitationId",
    zValidator("param", InvitationParamsSchema, zodProblemHook()),
    async (c) => {
      const { invitationId, organizationId } = c.req.valid("param");
      const session = c.get("session");
      const db = c.var.storage.db;
      const access = await requireTeamPermission({
        db,
        organizationId,
        permission: organizationPermissionChecks.invitationCancel,
        session,
      });

      if (!access.ok) {
        return c.json({ error: access.error }, access.status);
      }

      const auth = c.var.storage.auth;
      return auth.api.cancelInvitation({
        asResponse: true,
        body: { invitationId },
        headers: c.req.raw.headers,
      });
    }
  )
  .patch(
    "/organizations/:organizationId/members/:memberId/role",
    zValidator("param", MemberParamsSchema, zodProblemHook()),
    zValidator("json", UpdateMemberRoleBodySchema, zodProblemHook()),
    async (c) => {
      const { memberId, organizationId } = c.req.valid("param");
      const { role } = c.req.valid("json");
      const session = c.get("session");
      const db = c.var.storage.db;
      const access = await requireTeamPermission({
        db,
        organizationId,
        permission: organizationPermissionChecks.memberUpdate,
        session,
      });

      if (!access.ok) {
        return c.json({ error: access.error }, access.status);
      }

      const auth = c.var.storage.auth;
      return auth.api.updateMemberRole({
        asResponse: true,
        body: {
          memberId,
          organizationId,
          role,
        },
        headers: c.req.raw.headers,
      });
    }
  )
  .delete(
    "/organizations/:organizationId/members/:memberId",
    zValidator("param", MemberParamsSchema, zodProblemHook()),
    async (c) => {
      const { memberId, organizationId } = c.req.valid("param");
      const session = c.get("session");
      const db = c.var.storage.db;
      const access = await requireTeamPermission({
        db,
        organizationId,
        permission: organizationPermissionChecks.memberDelete,
        session,
      });

      if (!access.ok) {
        return c.json({ error: access.error }, access.status);
      }

      const auth = c.var.storage.auth;
      return auth.api.removeMember({
        asResponse: true,
        body: {
          memberIdOrEmail: memberId,
          organizationId,
        },
        headers: c.req.raw.headers,
      });
    }
  );
