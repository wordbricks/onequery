export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export {
  getOrganizationInvitationExpiresAt,
  ORGANIZATION_INVITATION_EXPIRES_IN_DAYS,
  ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS,
} from "./organization";
export {
  hasOrganizationAdminAccess,
  hasOrganizationPermission,
  hasOrganizationRole,
  isOrganizationRoleName,
  organizationRoleNames,
  resolveOrganizationRoleNames,
  serializeOrganizationRoleNames,
} from "./organization-permissions";
export type {
  OrganizationPermissionName,
  OrganizationRoleInput,
  OrganizationRoleName,
} from "./organization-permissions";
