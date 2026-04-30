import { resolveOrganizationSlug } from "@/features/organizations/organization-options";
import type { OrganizationOption } from "@/features/organizations/organization-options";
import type { PendingUserInvitation } from "@/queries/organization-invitation-queries";

type PostAuthLandingTarget =
  | {
      kind: "invite";
      invitationId: string;
    }
  | {
      kind: "inviteOnlyPendingAccess";
    }
  | {
      kind: "onboardingCreateOrg";
    }
  | {
      kind: "organizationHome";
      organizationSlug: string;
    };

export function resolvePostAuthLandingTarget(input: {
  organizations: OrganizationOption[];
  pendingInvitations: PendingUserInvitation[];
  signupMode?: "first-user" | "invite-only";
}): PostAuthLandingTarget {
  const firstOrganization = input.organizations.at(0);
  if (firstOrganization) {
    return {
      kind: "organizationHome",
      organizationSlug: resolveOrganizationSlug(firstOrganization),
    };
  }

  const preferredInvitation = findPreferredPendingInvitation(
    input.pendingInvitations
  );
  if (preferredInvitation) {
    return {
      kind: "invite",
      invitationId: preferredInvitation.id,
    };
  }

  if (input.signupMode === "invite-only") {
    return { kind: "inviteOnlyPendingAccess" };
  }

  return { kind: "onboardingCreateOrg" };
}

function findPreferredPendingInvitation(
  invitations: PendingUserInvitation[]
): PendingUserInvitation | null {
  if (invitations.length === 0) {
    return null;
  }

  // Comment: there is no dedicated multi-invitation landing page yet, so pick
  // the newest pending invitation deterministically instead of relying on API
  // result ordering.
  return [...invitations].sort(comparePendingInvitations)[0] ?? null;
}

function comparePendingInvitations(
  left: PendingUserInvitation,
  right: PendingUserInvitation
): number {
  const createdAtDifference =
    Date.parse(right.createdAt) - Date.parse(left.createdAt);

  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return left.id.localeCompare(right.id);
}
