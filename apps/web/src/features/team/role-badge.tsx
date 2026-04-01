import { Badge } from "@onequery/ui/components/badge";

import type { OrganizationRoleName } from "@/lib/organization-role-access";

type MemberRole = OrganizationRoleName;

type RoleBadgeProps = {
  role: MemberRole;
};

type RoleBadgesProps = {
  roleNames: readonly MemberRole[];
  rawRole?: string | null;
  emptyLabel?: string;
};

function getRoleVariant(role: MemberRole): "default" | "secondary" | "outline" {
  switch (role) {
    case "owner": {
      return "default";
    }
    case "admin": {
      return "secondary";
    }
    case "member": {
      return "outline";
    }
  }
}

function getRoleLabel(role: MemberRole): string {
  switch (role) {
    case "owner": {
      return "Owner";
    }
    case "admin": {
      return "Admin";
    }
    case "member": {
      return "Member";
    }
  }
}

function RoleBadge({ role }: RoleBadgeProps) {
  return <Badge variant={getRoleVariant(role)}>{getRoleLabel(role)}</Badge>;
}

export function RoleBadges({
  roleNames,
  rawRole,
  emptyLabel,
}: RoleBadgesProps) {
  if (roleNames.length === 0) {
    const fallbackLabel = rawRole?.trim() || emptyLabel;

    return fallbackLabel ? (
      <Badge variant="outline">{fallbackLabel}</Badge>
    ) : null;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {roleNames.map((roleName) => (
        <RoleBadge key={roleName} role={roleName} />
      ))}
    </div>
  );
}
