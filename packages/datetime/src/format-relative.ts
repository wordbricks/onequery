type DateInput = Date | string;

type RelativeTimeUnit =
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | "years";

interface Division {
  amount: number;
  unit: RelativeTimeUnit;
}

const INVALID_DATE_LABEL = "Invalid date";
const MILLISECONDS_PER_SECOND = 1_000;
const RELATIVE_TIME_FORMAT_OPTIONS = { numeric: "auto" } as const;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const WEEKS_PER_MONTH = 4.345_24;
const MONTHS_PER_YEAR = 12;

const DIVISIONS: readonly Division[] = [
  { amount: SECONDS_PER_MINUTE, unit: "seconds" },
  { amount: MINUTES_PER_HOUR, unit: "minutes" },
  { amount: HOURS_PER_DAY, unit: "hours" },
  { amount: DAYS_PER_WEEK, unit: "days" },
  // Comment: this week-to-month cutoff uses an average month length because
  // Intl.RelativeTimeFormat accepts only one unit at a time.
  { amount: WEEKS_PER_MONTH, unit: "weeks" },
  { amount: MONTHS_PER_YEAR, unit: "months" },
  { amount: Number.POSITIVE_INFINITY, unit: "years" },
];

function toDate(input: DateInput): Date {
  return typeof input === "string" ? new Date(input) : input;
}

export function formatRelativeTime(
  date: DateInput,
  locale?: string,
  now?: Date
): string {
  const rtf = new Intl.RelativeTimeFormat(locale, RELATIVE_TIME_FORMAT_OPTIONS);
  const target = toDate(date);
  const targetMs = target.getTime();
  if (!Number.isFinite(targetMs)) {
    return INVALID_DATE_LABEL;
  }
  const reference = now ?? new Date();
  const referenceMs = reference.getTime();
  if (!Number.isFinite(referenceMs)) {
    return INVALID_DATE_LABEL;
  }
  let seconds = (targetMs - referenceMs) / MILLISECONDS_PER_SECOND;

  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(seconds) < amount) {
      return rtf.format(Math.round(seconds), unit);
    }
    seconds /= amount;
  }

  return rtf.format(Math.round(seconds), "years");
}
