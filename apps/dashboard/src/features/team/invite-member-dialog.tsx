import { zodResolver } from "@hookform/resolvers/zod";
import { getOrganizationInvitationExpiresAt } from "@onequery/base";
import { formatDate } from "@onequery/datetime/format-date";
import { Button } from "@onequery/ui/components/button";
import { CopyButton } from "@onequery/ui/components/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@onequery/ui/components/dialog";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import { useState } from "react";
import type { ReactElement } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { inviteTeamMember } from "@/features/team/team-management-api";
import {
  defaultAssignableTeamRoleNames,
  useTeamRoleSelectionController,
} from "@/features/team/team-role-selection-controller";
import type { AssignableTeamRoleName } from "@/features/team/team-role-selection-controller";
import { TeamRoleSelectionField } from "@/features/team/team-role-selection-field";
import { buildInvitePath } from "@/lib/app-routes";
import { getBrowserOrigin } from "@/lib/browser-origin";
import { serializeOrganizationRoleNames } from "@/lib/organization-role-access";
import { useOptimisticAdd } from "@/lib/use-optimistic-mutation";
import { teamInvitationsQueryOptions } from "@/queries/team-queries";
import type { Invitation } from "@/queries/team-queries";

const InviteMemberFormSchema = z.object({
  email: z.email("Please enter a valid email address"),
});

type InviteMemberFormData = z.infer<typeof InviteMemberFormSchema>;
type InviteMemberMutationInput = InviteMemberFormData & {
  roleNames: AssignableTeamRoleName[];
};
type InviteMemberResponse = Awaited<ReturnType<typeof inviteTeamMember>>;

type InviteLinkState = {
  expiresAt: string;
  url: string;
};

interface InviteMemberDialogProps {
  children: ReactElement;
  currentUserId: string;
  organizationId: string;
}

export function InviteMemberDialog({
  children,
  currentUserId,
  organizationId,
}: InviteMemberDialogProps) {
  const [open, setOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<InviteLinkState | null>(null);
  const [roleErrorMessage, setRoleErrorMessage] = useState<string | null>(null);
  const roleSelection = useTeamRoleSelectionController({
    initialRoleNames: defaultAssignableTeamRoleNames,
  });

  const form = useForm<InviteMemberFormData>({
    defaultValues: {
      email: "",
    },
    resolver: zodResolver(InviteMemberFormSchema),
  });

  const mutation = useOptimisticAdd<
    InviteMemberResponse,
    InviteMemberMutationInput,
    Invitation
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      email: data.email,
      rawRole: serializeOrganizationRoleNames(data.roleNames),
      roleNames: [...data.roleNames],
      status: "pending",
      expiresAt: getOrganizationInvitationExpiresAt().toISOString(),
      organizationId,
      inviterId: "current-user",
    }),
    errorMessage: "Failed to create invitation link",
    mutationFn: async (data) =>
      inviteTeamMember({
        email: data.email,
        organizationId,
        roleNames: data.roleNames,
      }),
    onSuccess: (data) => {
      if (data?.id) {
        setInviteLink({
          expiresAt:
            data.expiresAt ??
            getOrganizationInvitationExpiresAt().toISOString(),
          url: `${getBrowserOrigin()}${buildInvitePath(data.id)}`,
        });
      }
      form.reset();
      roleSelection.reset();
      setRoleErrorMessage(null);
    },
    queryKey: teamInvitationsQueryOptions(currentUserId, organizationId)
      .queryKey,
    successMessage: "Invitation link created",
  });

  const onSubmit = (data: InviteMemberFormData) => {
    if (roleSelection.isSelectionEmpty) {
      setRoleErrorMessage("Select at least one role");
      return;
    }

    mutation.mutate({
      ...data,
      roleNames: roleSelection.selectedRoleNames,
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setInviteLink(null);
      setRoleErrorMessage(null);
      roleSelection.reset();
      form.reset();
    }
  };

  const handleToggleRole = (roleName: AssignableTeamRoleName) => {
    if (roleErrorMessage) {
      setRoleErrorMessage(null);
    }

    roleSelection.toggleRole(roleName);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={children} />
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Create Invitation Link</DialogTitle>
          <DialogDescription>
            Create a shareable invitation link for this organization. The
            recipient will sign in with an existing account or create their own
            before accepting.
          </DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <>
            <div className="space-y-2 pt-4">
              <Label>Invitation Link</Label>
              <div className="flex gap-2">
                <Input
                  value={inviteLink.url}
                  readOnly
                  className="flex-1 text-sm"
                />
                <CopyButton value={inviteLink.url} />
              </div>
              <p className="text-xs text-muted-foreground">
                Share this link with the invitee. They&apos;ll accept it after
                signing in or creating an account. The link expires on{" "}
                {formatDate(inviteLink.expiresAt)}.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteLink(null)}
              >
                Create Another Link
              </Button>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 pt-4"
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="colleague@example.com"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            <TeamRoleSelectionField
              errorMessage={roleErrorMessage}
              helperText="Select one or more roles for this invitation."
              onToggleRole={handleToggleRole}
              selectedRoleNames={roleSelection.selectedRoleNames}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || roleSelection.isSelectionEmpty}
              >
                {mutation.isPending
                  ? "Creating Link..."
                  : "Create Invitation Link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
