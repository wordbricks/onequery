export const ROOT_ROUTE = "/" as const;
export const SIGNIN_ROUTE = "/signin" as const;
export const DEVICE_ROUTE = "/device" as const;
export const AUTH_CALLBACK_ROUTE = "/auth/callback" as const;
export const INVITE_ROUTE = "/invite/$invitationId" as const;
export const ORGANIZATION_HOME_ROUTE = "/$org_slug/home" as const;

export function buildDeviceAuthPath(userCode?: string | null): string {
  if (!userCode) {
    return DEVICE_ROUTE;
  }

  return `${DEVICE_ROUTE}?${new URLSearchParams({
    user_code: userCode,
  }).toString()}`;
}

export function buildInvitePath(invitationId: string): string {
  return `/invite/${invitationId}`;
}
