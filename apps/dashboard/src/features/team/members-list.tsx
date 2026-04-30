import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@onequery/ui/components/avatar";
import { Button } from "@onequery/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@onequery/ui/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@onequery/ui/components/table";
import { IconDotsVertical, IconTrash, IconUserEdit } from "@tabler/icons-react";
import { useState } from "react";

import { ChangeRoleDialog } from "@/features/team/change-role-dialog";
import { RoleBadges } from "@/features/team/role-badge";
import { removeTeamMember } from "@/features/team/team-management-api";
import { hasOrganizationRole } from "@/lib/organization-role-access";
import { useOptimisticDelete } from "@/lib/use-optimistic-mutation";
import { teamMembersQueryOptions } from "@/queries/team-queries";
import type { Member } from "@/queries/team-queries";

interface MembersListProps {
  members: Member[];
  currentUserId: string;
  canManageMemberMutations: boolean;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function MemberRow({
  member,
  currentUserId,
  canManageMemberMutations,
}: {
  member: Member;
  currentUserId: string;
  canManageMemberMutations: boolean;
}) {
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const isCurrentUser = member.userId === currentUserId;
  const isOwner = hasOrganizationRole({
    roleName: "owner",
    rawRole: member.rawRole,
  });

  const removeMutation = useOptimisticDelete<void, Member>({
    errorMessage: "Failed to remove member",
    itemId: member.id,
    mutationFn: async () => {
      await removeTeamMember({
        memberId: member.id,
        organizationId: member.organizationId,
      });
    },
    queryKey: teamMembersQueryOptions(currentUserId, member.organizationId)
      .queryKey,
    successMessage: "Member removed",
  });

  const canEdit = canManageMemberMutations && !isOwner && !isCurrentUser;
  const canRemove = canManageMemberMutations && !isOwner && !isCurrentUser;

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-3">
            <Avatar size="sm">
              {member.user.image && <AvatarImage src={member.user.image} />}
              <AvatarFallback>{getInitials(member.user.name)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium">{member.user.name}</div>
              <div className="text-muted-foreground text-sm">
                {member.user.email}
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <RoleBadges roleNames={member.roleNames} rawRole={member.rawRole} />
        </TableCell>
        <TableCell className="text-right">
          {(canEdit || canRemove) && (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button variant="ghost" size="icon-sm">
                  <IconDotsVertical size={16} stroke={2} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onClick={() => setShowRoleDialog(true)}>
                    <IconUserEdit size={16} stroke={2} />
                    Change Role
                  </DropdownMenuItem>
                )}
                {canRemove && (
                  <DropdownMenuItem
                    onClick={() => removeMutation.mutate()}
                    disabled={removeMutation.isPending}
                    className="text-destructive focus:text-destructive"
                  >
                    <IconTrash size={16} stroke={2} />
                    {removeMutation.isPending ? "Removing..." : "Remove"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </TableCell>
      </TableRow>

      <ChangeRoleDialog
        open={showRoleDialog}
        onOpenChange={setShowRoleDialog}
        currentUserId={currentUserId}
        member={member}
      />
    </>
  );
}

export function MembersList({
  members,
  currentUserId,
  canManageMemberMutations,
}: MembersListProps) {
  if (members.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No members found.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="text-right w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              currentUserId={currentUserId}
              canManageMemberMutations={canManageMemberMutations}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
