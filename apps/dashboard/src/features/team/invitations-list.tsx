import { Button } from "@onequery/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onequery/ui/components/table";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";

import { RoleBadges } from "@/features/team/role-badge";
import { cancelTeamInvitation } from "@/features/team/team-management-api";
import { useOptimisticDelete } from "@/lib/use-optimistic-mutation";
import { teamInvitationsQueryOptions } from "@/queries/team-queries";
import type { Invitation } from "@/queries/team-queries";

interface InvitationsListProps {
  currentUserId: string;
  organizationId: string;
  canManageInvitationMutations: boolean;
}

function formatExpiration(expiresAt: string): string {
  const diffMs = Date.parse(expiresAt) - Date.now();

  if (diffMs < 0) {
    return "Expired";
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(
    (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );

  if (diffDays > 0) {
    return `Expires in ${diffDays}d`;
  }
  if (diffHours > 0) {
    return `Expires in ${diffHours}h`;
  }
  return "Expires soon";
}

function InvitationRow({
  invitation,
  currentUserId,
  organizationId,
  canManageInvitationMutations,
}: {
  invitation: Invitation;
  currentUserId: string;
  organizationId: string;
  canManageInvitationMutations: boolean;
}) {
  const cancelMutation = useOptimisticDelete<void, Invitation>({
    errorMessage: "Failed to cancel invitation",
    itemId: invitation.id,
    mutationFn: async () => {
      await cancelTeamInvitation({
        invitationId: invitation.id,
        organizationId,
      });
    },
    queryKey: teamInvitationsQueryOptions(
      currentUserId,
      invitation.organizationId
    ).queryKey,
    successMessage: "Invitation cancelled",
  });

  const isExpired = invitation.expiresAt
    ? Date.parse(invitation.expiresAt) < Date.now()
    : false;

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{invitation.email}</span>
      </TableCell>
      <TableCell>
        <RoleBadges
          roleNames={invitation.roleNames}
          rawRole={invitation.rawRole}
          emptyLabel="Member"
        />
      </TableCell>
      <TableCell>
        <span
          className={isExpired ? "text-destructive" : "text-muted-foreground"}
        >
          {invitation.expiresAt
            ? formatExpiration(invitation.expiresAt)
            : "Pending"}
        </span>
      </TableCell>
      <TableCell className="text-right">
        {canManageInvitationMutations && !isExpired && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            title="Cancel invitation"
          >
            {cancelMutation.isPending ? (
              <IconLoader2 size={16} className="animate-spin" />
            ) : (
              <IconX size={16} stroke={2} />
            )}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export function InvitationsList({
  currentUserId,
  organizationId,
  canManageInvitationMutations,
}: InvitationsListProps) {
  const invitationsQuery = useQuery(
    teamInvitationsQueryOptions(currentUserId, organizationId)
  );

  if (invitationsQuery.isPending) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading invitations...
      </div>
    );
  }

  if (invitationsQuery.isLoadingError) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load invitations.
      </div>
    );
  }

  const invitations = invitationsQuery.data;

  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending"
  );

  if (pendingInvitations.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No pending invitations.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pendingInvitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              currentUserId={currentUserId}
              organizationId={organizationId}
              canManageInvitationMutations={canManageInvitationMutations}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
