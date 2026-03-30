type DateInput = Date | string;
type DateStyle = "short" | "medium" | "long" | "full";
type TimeStyle = "short" | "medium";

const DEFAULT_DATE_STYLE: DateStyle = "medium";
const DEFAULT_TIME_STYLE: TimeStyle = "short";
const UTC_TIME_ZONE = "UTC";
const UTC_LABEL_SUFFIX = " UTC";
const DEFAULT_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: DEFAULT_DATE_STYLE,
  timeStyle: DEFAULT_TIME_STYLE,
};
const DEFAULT_UTC_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  ...DEFAULT_DATE_TIME_OPTIONS,
  timeZone: UTC_TIME_ZONE,
};

function toDate(input: DateInput): Date {
  return typeof input === "string" ? new Date(input) : input;
}

function omitTimeZoneName(
  options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormatOptions | undefined {
  if (!options) {
    return undefined;
  }
  const { timeZoneName: _timeZoneName, ...rest } = options;
  return rest;
}

function buildUtcDateTimeOptions(
  options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormatOptions {
  if (!options) {
    return DEFAULT_UTC_DATE_TIME_OPTIONS;
  }
  const safeOptions = omitTimeZoneName(options);
  return {
    ...safeOptions,
    timeZone: UTC_TIME_ZONE,
  };
}

export function formatDate(
  date: DateInput,
  locale?: string,
  style: DateStyle = DEFAULT_DATE_STYLE
): string {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: style });
  return formatter.format(toDate(date));
}

export function formatDateTime(
  date: DateInput,
  locale?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const formatter = new Intl.DateTimeFormat(
    locale,
    options ?? DEFAULT_DATE_TIME_OPTIONS
  );
  return formatter.format(toDate(date));
}

export function formatUtcDateTimeLabel(
  date: DateInput,
  locale?: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const formatter = new Intl.DateTimeFormat(
    locale,
    buildUtcDateTimeOptions(options)
  );
  return `${formatter.format(toDate(date))}${UTC_LABEL_SUFFIX}`;
}

export function formatTime(
  date: DateInput,
  locale?: string,
  style: TimeStyle = DEFAULT_TIME_STYLE
): string {
  const formatter = new Intl.DateTimeFormat(locale, { timeStyle: style });
  return formatter.format(toDate(date));
}
