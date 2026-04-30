import { normalizeDeviceUserCode } from "@onequery/base/device-auth";

import { sanitizeOnboardingOrganizationId } from "@/lib/onboarding-organization-id";

export const ROOT_ROUTE = "/" as const;
export const SIGNIN_ROUTE = "/signin" as const;
export const DEVICE_ROUTE = "/device" as const;
export const AUTH_CALLBACK_ROUTE = "/auth/callback" as const;
export const CONNECT_DATABASE_ROUTE = "/onboarding/connect-database" as const;
export const INVITE_ROUTE = "/invite/$invitationId" as const;
export const ORGANIZATION_HOME_ROUTE = "/$org_slug/home" as const;

export function buildDeviceAuthPath(
  userCode?: string | null,
  organizationId?: string | null
): string {
  const normalizedUserCode = normalizeDeviceUserCode(userCode);
  if (!normalizedUserCode) {
    return DEVICE_ROUTE;
  }

  const searchParams = new URLSearchParams({
    user_code: normalizedUserCode,
  });
  const safeOrganizationId = sanitizeOnboardingOrganizationId(organizationId);
  if (safeOrganizationId) {
    searchParams.set("orgId", safeOrganizationId);
  }

  return `${DEVICE_ROUTE}?${searchParams.toString()}`;
}

export function buildConnectDatabasePath(
  organizationId?: string | null
): string {
  const safeOrganizationId = sanitizeOnboardingOrganizationId(organizationId);
  if (!safeOrganizationId) {
    return CONNECT_DATABASE_ROUTE;
  }

  return `${CONNECT_DATABASE_ROUTE}?${new URLSearchParams({
    orgId: safeOrganizationId,
  }).toString()}`;
}

export function buildInvitePath(invitationId: string): string {
  return `/invite/${invitationId}`;
}
