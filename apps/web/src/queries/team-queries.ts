import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { organization } from "@/lib/auth-client";
import { resolveOrganizationRoleNames } from "@/lib/organization-role-access";
import type { OrganizationRoleName } from "@/lib/organization-role-access";
import type { UserScope } from "@/queries/organization-query-keys";
import { teamQueryKeys } from "@/queries/team-query-keys";

const organizationRoleStorageSchema = z.string();

function normalizeOrganizationRole(input: string | null | undefined) {
  return {
    rawRole: input ?? null,
    roleNames: resolveOrganizationRoleNames(input),
  } as const satisfies {
    rawRole: string | null;
    roleNames: OrganizationRoleName[];
  };
}

const memberSchema = z
  .object({
    createdAt: z.coerce.date(),
    id: z.string(),
    organizationId: z.string(),
    role: organizationRoleStorageSchema,
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      image: z.string().nullable(),
    }),
    userId: z.string(),
  })
  .transform((member) => ({
    createdAt: member.createdAt,
    id: member.id,
    organizationId: member.organizationId,
    ...normalizeOrganizationRole(member.role),
    user: member.user,
    userId: member.userId,
  }));

const membersResponseSchema = z.object({
  members: z.array(memberSchema),
});

const invitationSchema = z
  .object({
    email: z.string(),
    expiresAt: z.coerce.date().optional(),
    id: z.string(),
    inviterId: z.string().optional(),
    organizationId: z.string(),
    role: organizationRoleStorageSchema.nullable().optional(),
    status: z.string(),
  })
  .transform((invitation) => ({
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    id: invitation.id,
    inviterId: invitation.inviterId,
    organizationId: invitation.organizationId,
    ...normalizeOrganizationRole(invitation.role),
    status: invitation.status,
  }));

const invitationsResponseSchema = z.array(invitationSchema);

export type Member = z.infer<typeof memberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;

async function fetchMembers(organizationId: string): Promise<Member[]> {
  const result = await organization.listMembers({
    query: { organizationId },
  });
  if (!result.data) {
    throw new Error("Failed to fetch members");
  }

  return membersResponseSchema.parse(result.data).members;
}

async function fetchInvitations(organizationId: string): Promise<Invitation[]> {
  const result = await organization.listInvitations({
    query: { organizationId },
  });
  if (!result.data) {
    throw new Error("Failed to fetch invitations");
  }

  return invitationsResponseSchema.parse(result.data);
}

export function teamMembersQueryOptions(
  userId: UserScope,
  organizationId: string
) {
  return queryOptions({
    queryFn: async () => fetchMembers(organizationId),
    // Comment: membership data is persisted client-side and authorization-
    // sensitive, so cache entries must be scoped by authenticated user.
    queryKey: teamQueryKeys.members(userId, organizationId),
  });
}

export function teamInvitationsQueryOptions(
  userId: UserScope,
  organizationId: string
) {
  return queryOptions({
    queryFn: async () => fetchInvitations(organizationId),
    // Comment: invitation visibility is also permission-sensitive, so do not
    // share persisted cache entries across users for the same organization.
    queryKey: teamQueryKeys.invitations(userId, organizationId),
  });
}
