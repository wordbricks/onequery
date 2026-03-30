import { resolveOrganizationRoleNames } from "@onequery/base/organization-permissions";
import type {
  OrganizationPermissionName,
  OrganizationRoleInput,
  OrganizationRoleName,
} from "@onequery/base/organization-permissions";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export const organizationPermissionStatements = {
  ...defaultStatements,
  cliOrg: ["list", "read"],
  cliQuery: ["execute"],
  cliSource: ["connect", "list", "read"],
} as const;

export const organizationAccessControl = createAccessControl(
  organizationPermissionStatements
);

export const organizationRoles = {
  admin: organizationAccessControl.newRole({
    ...adminAc.statements,
    cliOrg: [...organizationPermissionStatements.cliOrg],
    cliSource: [...organizationPermissionStatements.cliSource],
    cliQuery: [...organizationPermissionStatements.cliQuery],
  }),
  member: organizationAccessControl.newRole({
    ...memberAc.statements,
    cliOrg: [...organizationPermissionStatements.cliOrg],
    cliSource: [...organizationPermissionStatements.cliSource],
    cliQuery: [...organizationPermissionStatements.cliQuery],
  }),
  owner: organizationAccessControl.newRole({
    ...ownerAc.statements,
    cliOrg: [...organizationPermissionStatements.cliOrg],
    cliSource: [...organizationPermissionStatements.cliSource],
    cliQuery: [...organizationPermissionStatements.cliQuery],
  }),
} as const;

export {
  hasOrganizationAdminAccess,
  hasOrganizationPermission,
  hasOrganizationRole,
  isOrganizationRoleName,
  organizationRoleNames,
  resolveOrganizationRoleNames,
  serializeOrganizationRoleNames,
} from "@onequery/base/organization-permissions";
export type {
  OrganizationPermissionName,
  OrganizationRoleInput,
  OrganizationRoleName,
} from "@onequery/base/organization-permissions";

export type OrganizationPermissionCheck = Parameters<
  (typeof organizationRoles)[OrganizationRoleName]["authorize"]
>[0];

export const organizationPermissionChecks = {
  auditRead: {
    cliOrg: ["read"],
  },
  organizationUpdate: {
    organization: ["update"],
  },
  cliOrgList: {
    cliOrg: ["list"],
  },
  cliOrgRead: {
    cliOrg: ["read"],
  },
  cliQueryExecute: {
    cliQuery: ["execute"],
  },
  cliSourceList: {
    cliSource: ["list"],
  },
  cliSourceConnect: {
    cliSource: ["connect"],
  },
  cliSourceRead: {
    cliSource: ["read"],
  },
  invitationCreate: {
    invitation: ["create"],
  },
  invitationCancel: {
    invitation: ["cancel"],
  },
  memberDelete: {
    member: ["delete"],
  },
  memberUpdate: {
    member: ["update"],
  },
} as const satisfies Record<
  | OrganizationPermissionName
  | "auditRead"
  | "cliOrgList"
  | "cliOrgRead"
  | "cliQueryExecute"
  | "cliSourceList"
  | "cliSourceConnect"
  | "cliSourceRead",
  OrganizationPermissionCheck
>;

function doesKnownOrganizationRoleGrantPermission(input: {
  permission: OrganizationPermissionCheck;
  roleName: string;
}): boolean {
  // Treat malformed runtime payloads as unauthorized instead of throwing
  // inside permission checks.
  if (!Object.hasOwn(organizationRoles, input.roleName)) {
    return false;
  }

  return organizationRoles[
    input.roleName as keyof typeof organizationRoles
  ].authorize(input.permission).success;
}

export function doOrganizationRolesGrantPermission(input: {
  roleNames: readonly OrganizationRoleName[];
  permission: OrganizationPermissionCheck;
}): boolean {
  return input.roleNames.some((roleName) =>
    doesKnownOrganizationRoleGrantPermission({
      permission: input.permission,
      roleName,
    })
  );
}

export function doesOrganizationMembershipGrantPermission(input: {
  rawRole: OrganizationRoleInput;
  permission: OrganizationPermissionCheck;
}): boolean {
  return doOrganizationRolesGrantPermission({
    permission: input.permission,
    roleNames: resolveOrganizationRoleNames(input.rawRole),
  });
}

export function canReadOrganizationAudit(input: {
  rawRole: OrganizationRoleInput;
}): boolean {
  return doesOrganizationMembershipGrantPermission({
    permission: organizationPermissionChecks.auditRead,
    rawRole: input.rawRole,
  });
}

export function getOrganizationRoleNamesWithPermission(input: {
  rawRole: OrganizationRoleInput;
  permission: OrganizationPermissionCheck;
}): OrganizationRoleName[] {
  return resolveOrganizationRoleNames(input.rawRole).filter((roleName) =>
    doesKnownOrganizationRoleGrantPermission({
      permission: input.permission,
      roleName,
    })
  );
}
