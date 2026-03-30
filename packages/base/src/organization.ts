// Comment: Keep invitation lifetime configuration in a browser-safe shared
// module so Better Auth settings and invite UI copy stay aligned.
export const ORGANIZATION_INVITATION_EXPIRES_IN_DAYS = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;

export const ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS =
  ORGANIZATION_INVITATION_EXPIRES_IN_DAYS *
  HOURS_PER_DAY *
  MINUTES_PER_HOUR *
  SECONDS_PER_MINUTE;

const ORGANIZATION_INVITATION_EXPIRES_IN_MILLISECONDS =
  ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS * MILLISECONDS_PER_SECOND;

export function getOrganizationInvitationExpiresAt(
  referenceDate: Date = new Date()
): Date {
  const referenceTime = referenceDate.getTime();

  if (!Number.isFinite(referenceTime)) {
    throw new Error("Reference date must be valid");
  }

  return new Date(
    referenceTime + ORGANIZATION_INVITATION_EXPIRES_IN_MILLISECONDS
  );
}
