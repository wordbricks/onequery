import { Button } from "@onequery/ui/components/button";
import { IconUserPlus } from "@tabler/icons-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { InvitationsList } from "@/features/team/invitations-list";
import { InviteMemberDialog } from "@/features/team/invite-member-dialog";
import { MembersList } from "@/features/team/members-list";
import { getTeamAccessState } from "@/features/team/team-access";
import { teamMembersQueryOptions } from "@/queries/team-queries";

const routeApi = getRouteApi("/_authenticated/$org_slug/team");

function TeamPageContent(props: {
  organizationId: string;
  currentUserId: string;
}) {
  const { data: members } = useSuspenseQuery(
    teamMembersQueryOptions(props.currentUserId, props.organizationId)
  );

  const { canInviteMembers, canManageMembershipMutations, canReadInvitations } =
    getTeamAccessState({
      currentUserId: props.currentUserId,
      members,
    });

  return (
    <div className="space-y-8">
      {/* Header with invite button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Members</h2>
          <p className="text-sm text-muted-foreground">
            People who have access to this organization. Invite teammates to let
            them join with their own account.
          </p>
        </div>
        {canInviteMembers ? (
          <div className="flex flex-wrap items-center gap-2">
            {canManageMembershipMutations ? (
              <InviteMemberDialog
                currentUserId={props.currentUserId}
                organizationId={props.organizationId}
              >
                <Button>
                  <IconUserPlus size={16} stroke={2} />
                  Create Invitation Link
                </Button>
              </InviteMemberDialog>
            ) : null}
          </div>
        ) : null}
      </div>

      <MembersList
        members={members}
        currentUserId={props.currentUserId}
        canManageMemberMutations={canManageMembershipMutations}
      />

      {canReadInvitations ? (
        <div>
          <h2 className="text-xl font-semibold mb-2">Pending Invitations</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Invitations that haven't been accepted yet.
          </p>
          <InvitationsList
            currentUserId={props.currentUserId}
            organizationId={props.organizationId}
            canManageInvitationMutations={canManageMembershipMutations}
          />
        </div>
      ) : null}
    </div>
  );
}

function TeamPageHeader() {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold">Team</h1>
      <p className="text-muted-foreground mt-2">
        Manage your members and create invitation links for new teammates.
      </p>
    </div>
  );
}

export function TeamPage() {
  const routeContext = routeApi.useRouteContext();
  const { organizationId, session } = routeContext;
  const currentUserId = session.user.id;

  return (
    <div className="p-8">
      <TeamPageHeader />

      <TeamPageContent
        organizationId={organizationId}
        currentUserId={currentUserId}
      />
    </div>
  );
}
