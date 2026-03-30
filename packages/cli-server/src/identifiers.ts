export const CLI_ORG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CLI_SAFE_PATH_SEGMENT_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$|^[A-Za-z0-9]$/;

function isCliSafePathSegment(value: string): boolean {
  return CLI_SAFE_PATH_SEGMENT_PATTERN.test(value);
}

export function isCliSourceKey(value: string): boolean {
  return isCliSafePathSegment(value) && value !== "." && value !== "..";
}
