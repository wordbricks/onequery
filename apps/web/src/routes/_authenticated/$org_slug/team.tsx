import { createFileRoute } from "@tanstack/react-router";

import { getTeamAccessState } from "@/features/team/team-access";
import { TeamPage } from "@/pages/team-page";
import {
  teamInvitationsQueryOptions,
  teamMembersQueryOptions,
} from "@/queries/team-queries";

export const Route = createFileRoute("/_authenticated/$org_slug/team")({
  component: TeamPage,
  loader: async ({ context: { queryClient, organizationId, session } }) => {
    const members = await queryClient.ensureQueryData(
      teamMembersQueryOptions(session.user.id, organizationId)
    );

    const teamAccess = getTeamAccessState({
      currentUserId: session.user.id,
      members,
    });

    if (teamAccess.canReadInvitations) {
      // Comment: invitations are secondary route data. Prefetch them during
      // navigation, but keep the page shell rendering instead of suspending the
      // entire app at the root boundary while this query resolves.
      void queryClient.prefetchQuery(
        teamInvitationsQueryOptions(session.user.id, organizationId)
      );
    }
  },
});
