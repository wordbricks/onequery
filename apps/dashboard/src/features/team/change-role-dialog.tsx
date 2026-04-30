import { Button } from "@onequery/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@onequery/ui/components/dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";

import { updateTeamMemberRole } from "@/features/team/team-management-api";
import {
  resolveAssignableTeamRoleNames,
  useTeamRoleSelectionController,
} from "@/features/team/team-role-selection-controller";
import { TeamRoleSelectionField } from "@/features/team/team-role-selection-field";
import { serializeOrganizationRoleNames } from "@/lib/organization-role-access";
import { teamMembersQueryOptions } from "@/queries/team-queries";
import type { Member } from "@/queries/team-queries";

interface ChangeRoleDialogProps {
  currentUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member;
}

export function ChangeRoleDialog({
  currentUserId,
  open,
  onOpenChange,
  member,
}: ChangeRoleDialogProps) {
  const queryClient = useQueryClient();
  const memberRoleKey = serializeOrganizationRoleNames(member.roleNames);
  const initialSelectedRoles = useMemo(
    () => resolveAssignableTeamRoleNames(member.roleNames),
    [memberRoleKey]
  );
  const roleSelection = useTeamRoleSelectionController({
    initialRoleNames: initialSelectedRoles,
  });

  useEffect(() => {
    if (open) {
      roleSelection.resetToRoleNames(initialSelectedRoles);
    }
  }, [initialSelectedRoles, member.id, open, roleSelection.resetToRoleNames]);

  const mutation = useMutation({
    mutationFn: async () => {
      await updateTeamMemberRole({
        memberId: member.id,
        organizationId: member.organizationId,
        roleNames: roleSelection.selectedRoleNames,
      });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update role");
    },
    onSuccess: () => {
      toast.success("Role updated");
      void queryClient.invalidateQueries({
        queryKey: teamMembersQueryOptions(currentUserId, member.organizationId)
          .queryKey,
      });
      onOpenChange(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleSelection.hasChanges) {
      onOpenChange(false);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Change Role</DialogTitle>
          <DialogDescription>
            Update the role for {member.user.name}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <TeamRoleSelectionField
            helperText="Select one or more roles for this member."
            onToggleRole={roleSelection.toggleRole}
            selectedRoleNames={roleSelection.selectedRoleNames}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || roleSelection.isSelectionEmpty}
            >
              {mutation.isPending ? "Updating..." : "Update Role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
