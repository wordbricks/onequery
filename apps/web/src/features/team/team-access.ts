import {
  hasOrganizationPermission,
  resolveOrganizationRoleNames,
} from "@/lib/organization-role-access";
import type { Member } from "@/queries/team-queries";

export function getTeamAccessState(input: {
  currentUserId: string;
  members: readonly Member[];
}) {
  const currentMember = input.members.find(
    (member) => member.userId === input.currentUserId
  );
  const currentUserRoleNames = resolveOrganizationRoleNames(
    currentMember?.rawRole
  );
  const canManageMembershipMutations = hasOrganizationPermission({
    permission: "memberUpdate",
    rawRole: currentUserRoleNames,
  });

  return {
    canInviteMembers: hasOrganizationPermission({
      permission: "invitationCreate",
      rawRole: currentUserRoleNames,
    }),
    canManageMembershipMutations,
    canReadInvitations: hasOrganizationPermission({
      permission: "invitationCancel",
      rawRole: currentUserRoleNames,
    }),
    canUpdateOrganizationSettings: hasOrganizationPermission({
      permission: "organizationUpdate",
      rawRole: currentUserRoleNames,
    }),
    currentUserRoleNames,
  };
}
