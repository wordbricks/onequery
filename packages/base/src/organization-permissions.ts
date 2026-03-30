export const organizationRoleNames = ["owner", "admin", "member"] as const;

export type OrganizationRoleName = (typeof organizationRoleNames)[number];

export type OrganizationRoleInput =
  | string
  | readonly OrganizationRoleName[]
  | null
  | undefined;

export type OrganizationPermissionName =
  | "organizationUpdate"
  | "invitationCreate"
  | "invitationCancel"
  | "memberDelete"
  | "memberUpdate";

const ORGANIZATION_ROLE_NAME_SEPARATOR = ",";
const organizationAdminRoleNames = [
  "owner",
  "admin",
] as const satisfies readonly OrganizationRoleName[];
const organizationAdminRoleNameSet: ReadonlySet<OrganizationRoleName> = new Set(
  organizationAdminRoleNames
);

const organizationPermissionRoleNames = {
  invitationCancel: organizationAdminRoleNameSet,
  invitationCreate: organizationAdminRoleNameSet,
  memberDelete: organizationAdminRoleNameSet,
  memberUpdate: organizationAdminRoleNameSet,
  organizationUpdate: organizationAdminRoleNameSet,
} as const satisfies Record<
  OrganizationPermissionName,
  ReadonlySet<OrganizationRoleName>
>;

const organizationRoleNameSet = new Set<string>(organizationRoleNames);

export function isOrganizationRoleName(
  value: string
): value is OrganizationRoleName {
  return organizationRoleNameSet.has(value);
}

export function resolveOrganizationRoleNames(
  rawRole: OrganizationRoleInput
): OrganizationRoleName[] {
  const rawRoleNames = Array.isArray(rawRole)
    ? rawRole
    : typeof rawRole === "string"
      ? rawRole.split(ORGANIZATION_ROLE_NAME_SEPARATOR)
      : [];

  const roleNames: OrganizationRoleName[] = [];
  const seenRoleNames = new Set<OrganizationRoleName>();

  // Comment: Better Auth supports multi-role memberships, but this app still
  // persists them in a single text column. Keep parsing centralized so the
  // browser and server stay aligned.
  for (const rawRoleName of rawRoleNames) {
    const normalizedRoleName = rawRoleName.trim();

    if (
      !isOrganizationRoleName(normalizedRoleName) ||
      seenRoleNames.has(normalizedRoleName)
    ) {
      continue;
    }

    seenRoleNames.add(normalizedRoleName);
    roleNames.push(normalizedRoleName);
  }

  return roleNames;
}

export function serializeOrganizationRoleNames(
  roleNames: readonly OrganizationRoleName[]
): string {
  const normalizedRoleNameSet = new Set(
    resolveOrganizationRoleNames(roleNames)
  );

  return organizationRoleNames
    .filter((roleName) => normalizedRoleNameSet.has(roleName))
    .join(ORGANIZATION_ROLE_NAME_SEPARATOR);
}

export function hasOrganizationPermission(input: {
  permission: OrganizationPermissionName;
  rawRole: OrganizationRoleInput;
}): boolean {
  const allowedRoleNames = organizationPermissionRoleNames[input.permission];

  return resolveOrganizationRoleNames(input.rawRole).some((roleName) =>
    allowedRoleNames.has(roleName)
  );
}

export function hasOrganizationRole(input: {
  roleName: OrganizationRoleName;
  rawRole: OrganizationRoleInput;
}): boolean {
  return resolveOrganizationRoleNames(input.rawRole).includes(input.roleName);
}

export function hasOrganizationAdminAccess(input: {
  rawRole: OrganizationRoleInput;
}): boolean {
  return hasOrganizationPermission({
    permission: "organizationUpdate",
    rawRole: input.rawRole,
  });
}
