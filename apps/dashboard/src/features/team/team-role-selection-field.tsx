import { Checkbox } from "@onequery/ui/components/checkbox";
import { Label } from "@onequery/ui/components/label";

import { assignableTeamRoleOptions } from "@/features/team/team-role-selection-controller";
import type { AssignableTeamRoleName } from "@/features/team/team-role-selection-controller";

type TeamRoleSelectionFieldProps = {
  errorMessage?: string | null;
  helperText: string;
  onToggleRole: (roleName: AssignableTeamRoleName) => void;
  selectedRoleNames: readonly AssignableTeamRoleName[];
};

function shouldIgnoreRoleRowClick(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('[data-slot="checkbox"]') !== null
  );
}

export function TeamRoleSelectionField({
  errorMessage,
  helperText,
  onToggleRole,
  selectedRoleNames,
}: TeamRoleSelectionFieldProps) {
  return (
    <div className="space-y-2">
      <Label>Roles</Label>
      <div className="space-y-2">
        {assignableTeamRoleOptions.map((role) => {
          const checked = selectedRoleNames.includes(role.value);

          return (
            <button
              key={role.value}
              type="button"
              className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left hover:bg-accent/40"
              onClick={(event) => {
                if (shouldIgnoreRoleRowClick(event.target)) {
                  return;
                }

                onToggleRole(role.value);
              }}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggleRole(role.value)}
              />
              <div>
                <p className="font-medium">{role.label}</p>
              </div>
            </button>
          );
        })}
      </div>
      {errorMessage ? (
        <p className="text-sm text-destructive">{errorMessage}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}
