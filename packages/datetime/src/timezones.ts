/**
 * Get all supported IANA timezones using the Intl API.
 * Returns timezones sorted alphabetically.
 */
const DEFAULT_INTL_LOCALE = "en-US";
const TIME_ZONE_NAME_PART = "timeZoneName";
const LONG_OFFSET_TIME_ZONE_NAME = "longOffset";
const DEFAULT_UTC_OFFSET = "+00:00";
const UTC_TIMEZONE = "UTC";
const GMT_OFFSET_PATTERN = /GMT([+-])(\d{1,2})(?::(\d{2}))?/;
const TIME_SEPARATOR = ":";
const ZERO_MINUTES = "00";
const ZERO_PADDING = "0";
const PADDED_TIME_PART_LENGTH = 2;
const TWO_DIGIT_TIME_PART = "2-digit";
const SEARCHED_TIMEZONE_OFFSET_HOURS = 24;
const HOURS_SEARCH_WINDOW_LENGTH = SEARCHED_TIMEZONE_OFFSET_HOURS * 2 + 1;
const MILLISECONDS_PER_HOUR = 3_600_000;
const NORMALIZED_TIME_LENGTH = 5;
const TIMEZONE_LABEL_WORD_SEPARATOR = /_/g;
const TIMEZONE_SEARCH_OFFSETS = Array.from(
  { length: HOURS_SEARCH_WINDOW_LENGTH },
  (_, index) => index - SEARCHED_TIMEZONE_OFFSET_HOURS
);

export function getAllTimezones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

/**
 * Get the browser's detected timezone.
 * Returns an IANA timezone string like "America/New_York" or "Asia/Seoul".
 */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Get the UTC offset for a timezone at the current time.
 * Returns a string like "+09:00" or "-05:00".
 */
export function getTimezoneOffset(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat(DEFAULT_INTL_LOCALE, {
    timeZone: timezone,
    timeZoneName: LONG_OFFSET_TIME_ZONE_NAME,
  });

  const parts = formatter.formatToParts(now);
  const tzPart = parts.find((p) => p.type === TIME_ZONE_NAME_PART);

  if (!tzPart) {
    return DEFAULT_UTC_OFFSET;
  }

  // Extract offset from "GMT+9" or "GMT-5:30" format
  const match = tzPart.value.match(GMT_OFFSET_PATTERN);
  const sign = match?.[1];
  const hours = match?.[2];
  const minutes = match?.[3] ?? ZERO_MINUTES;
  if (!sign || !hours) {
    return DEFAULT_UTC_OFFSET;
  }
  const paddedHours = hours.padStart(PADDED_TIME_PART_LENGTH, ZERO_PADDING);
  return `${sign}${paddedHours}${TIME_SEPARATOR}${minutes}`;
}

/**
 * Format a timezone for display.
 * Returns a string like "(GMT+09:00) Asia/Seoul".
 */
export function formatTimezoneLabel(timezone: string): string {
  const offset = getTimezoneOffset(timezone);
  return `(GMT${offset}) ${timezone.replaceAll(
    TIMEZONE_LABEL_WORD_SEPARATOR,
    " "
  )}`;
}

function normalizeTimeString(time: string): string {
  return time.padStart(NORMALIZED_TIME_LENGTH, ZERO_PADDING);
}

/**
 * Convert a time string (HH:MM) from one timezone to another.
 * Useful for converting between local time and UTC.
 */
export function convertTime(
  time: string,
  fromTimezone: string,
  toTimezone: string
): string {
  const timeParts = time.split(TIME_SEPARATOR);
  const hoursPart = timeParts[0];
  const minutesPart = timeParts[1];
  if (!hoursPart || !minutesPart) {
    return time;
  }

  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return time;
  }

  // Create a date in the source timezone
  const sourceDate = new Date();
  sourceDate.setHours(hours, minutes, 0, 0);

  // Get the time parts in the source timezone
  const sourceFormatter = new Intl.DateTimeFormat(DEFAULT_INTL_LOCALE, {
    hour: TWO_DIGIT_TIME_PART,
    hour12: false,
    minute: TWO_DIGIT_TIME_PART,
    timeZone: fromTimezone,
  });

  // Get the time parts in the target timezone
  const targetFormatter = new Intl.DateTimeFormat(DEFAULT_INTL_LOCALE, {
    hour: TWO_DIGIT_TIME_PART,
    hour12: false,
    minute: TWO_DIGIT_TIME_PART,
    timeZone: toTimezone,
  });

  // Find the UTC date that corresponds to the given time in the source timezone
  // Comment: Intl does not expose direct wall-clock conversion across IANA
  // zones, so this helper still relies on a bounded +/-24 hour search.
  const normalizedTime = normalizeTimeString(time);
  for (const offsetHours of TIMEZONE_SEARCH_OFFSETS) {
    const testDate = new Date(
      sourceDate.getTime() + offsetHours * MILLISECONDS_PER_HOUR
    );
    const formattedSource = sourceFormatter.format(testDate);
    if (formattedSource === time || formattedSource === normalizedTime) {
      const result = targetFormatter.format(testDate);
      // Ensure HH:MM format
      const resultParts = result.split(TIME_SEPARATOR);
      const h = resultParts[0];
      const m = resultParts[1];
      if (!h || !m) {
        return result;
      }
      return `${h.padStart(PADDED_TIME_PART_LENGTH, ZERO_PADDING)}${TIME_SEPARATOR}${m}`;
    }
  }

  // Fallback: return original time
  return time;
}

/**
 * Convert a time from a specific timezone to UTC.
 */
export function timezoneToUtc(time: string, timezone: string): string {
  return convertTime(time, timezone, UTC_TIMEZONE);
}

/**
 * Convert a time from UTC to a specific timezone.
 */
export function utcToTimezone(time: string, timezone: string): string {
  return convertTime(time, UTC_TIMEZONE, timezone);
}
