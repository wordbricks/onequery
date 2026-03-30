export const APP_API_PATH = "/api" as const;
export const AUTH_BOOTSTRAP_STATE_API_PATH =
  `${APP_API_PATH}/auth/bootstrap-state` as const;
export const TEAM_ORGANIZATIONS_API_PREFIX =
  `${APP_API_PATH}/team/organizations` as const;

export function buildTeamOrganizationApiPath(
  organizationId: string,
  ...segments: string[]
): string {
  return [TEAM_ORGANIZATIONS_API_PREFIX, organizationId, ...segments].join("/");
}
