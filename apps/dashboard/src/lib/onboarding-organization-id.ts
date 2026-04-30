const MAX_ONBOARDING_ORGANIZATION_ID_LENGTH = 128;

export function sanitizeOnboardingOrganizationId(
  organizationId?: string | null
): string | undefined {
  const trimmedOrganizationId = organizationId?.trim();
  if (!trimmedOrganizationId) {
    return undefined;
  }

  if (
    trimmedOrganizationId.length > MAX_ONBOARDING_ORGANIZATION_ID_LENGTH ||
    /\s/.test(trimmedOrganizationId)
  ) {
    return undefined;
  }

  return trimmedOrganizationId;
}
