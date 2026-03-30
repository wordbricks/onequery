/// <reference path="./intl-duration-format.d.ts" />

type DurationStyle = "long" | "short" | "narrow" | "digital";

const DEFAULT_DURATION_STYLE: DurationStyle = "narrow";
const ZERO_DURATION_PART = 0;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR = MINUTES_PER_HOUR * MILLISECONDS_PER_MINUTE;
const NEGATIVE_DURATION_PREFIX = "-";
const LONG_DURATION_PART_SEPARATOR = ", ";
const NARROW_DURATION_PART_SEPARATOR = " ";
const LONG_DURATION_UNITS = {
  hours: ["hour", "hours"],
  milliseconds: ["millisecond", "milliseconds"],
  minutes: ["minute", "minutes"],
  seconds: ["second", "seconds"],
} as const;
const SHORT_DURATION_UNITS = {
  hours: "hr",
  milliseconds: "ms",
  minutes: "min",
  seconds: "sec",
} as const;
const NARROW_DURATION_UNITS = {
  hours: "h",
  milliseconds: "ms",
  minutes: "m",
  seconds: "s",
} as const;

interface DurationParts {
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

interface DurationPartsComplete {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

function msToParts(ms: number): DurationPartsComplete {
  const hours = Math.floor(ms / MILLISECONDS_PER_HOUR);
  const minutes = Math.floor(
    (ms % MILLISECONDS_PER_HOUR) / MILLISECONDS_PER_MINUTE
  );
  const seconds = Math.floor(
    (ms % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND
  );
  const milliseconds = ms % MILLISECONDS_PER_SECOND;

  return { hours, milliseconds, minutes, seconds };
}

function formatLongDurationUnit(
  value: number,
  [singular, plural]: readonly [string, string]
): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatSignedDuration(formatted: string, isNegative: boolean): string {
  return isNegative ? `${NEGATIVE_DURATION_PREFIX}${formatted}` : formatted;
}

function hasIntlDurationFormat(): boolean {
  return (
    typeof Intl !== "undefined" &&
    "DurationFormat" in Intl &&
    typeof Intl.DurationFormat === "function"
  );
}

function formatDurationFallback(
  parts: DurationParts,
  style: DurationStyle
): string {
  const hours = parts.hours ?? ZERO_DURATION_PART;
  const minutes = parts.minutes ?? ZERO_DURATION_PART;
  const seconds = parts.seconds ?? ZERO_DURATION_PART;
  const milliseconds = parts.milliseconds ?? ZERO_DURATION_PART;

  // Build parts array based on what's non-zero
  const formatted: string[] = [];

  if (style === "long") {
    if (hours > 0) {
      formatted.push(formatLongDurationUnit(hours, LONG_DURATION_UNITS.hours));
    }
    if (minutes > 0) {
      formatted.push(
        formatLongDurationUnit(minutes, LONG_DURATION_UNITS.minutes)
      );
    }
    if (seconds > 0) {
      formatted.push(
        formatLongDurationUnit(seconds, LONG_DURATION_UNITS.seconds)
      );
    }
    if (formatted.length === 0) {
      formatted.push(
        formatLongDurationUnit(milliseconds, LONG_DURATION_UNITS.milliseconds)
      );
    }
    return formatted.join(LONG_DURATION_PART_SEPARATOR);
  }

  if (style === "short") {
    if (hours > 0) {
      formatted.push(`${hours} ${SHORT_DURATION_UNITS.hours}`);
    }
    if (minutes > 0) {
      formatted.push(`${minutes} ${SHORT_DURATION_UNITS.minutes}`);
    }
    if (seconds > 0) {
      formatted.push(`${seconds} ${SHORT_DURATION_UNITS.seconds}`);
    }
    if (formatted.length === 0) {
      formatted.push(`${milliseconds} ${SHORT_DURATION_UNITS.milliseconds}`);
    }
    return formatted.join(LONG_DURATION_PART_SEPARATOR);
  }

  if (hours > 0) {
    formatted.push(`${hours}${NARROW_DURATION_UNITS.hours}`);
  }
  if (minutes > 0) {
    formatted.push(`${minutes}${NARROW_DURATION_UNITS.minutes}`);
  }
  if (seconds > 0) {
    formatted.push(`${seconds}${NARROW_DURATION_UNITS.seconds}`);
  }
  if (formatted.length === 0) {
    formatted.push(`${milliseconds}${NARROW_DURATION_UNITS.milliseconds}`);
  }

  return formatted.join(NARROW_DURATION_PART_SEPARATOR);
}

export function formatDuration(
  ms: number,
  locale?: string,
  style: DurationStyle = DEFAULT_DURATION_STYLE
): string {
  const safeMs = Number.isFinite(ms) ? ms : ZERO_DURATION_PART;
  const isNegative = safeMs < ZERO_DURATION_PART;
  const absMs = Math.abs(safeMs);
  const parts = msToParts(absMs);
  const hours = parts.hours;
  const minutes = parts.minutes;
  const seconds = parts.seconds;
  const milliseconds = parts.milliseconds;

  if (!hasIntlDurationFormat()) {
    if (absMs < MILLISECONDS_PER_SECOND) {
      const formatted = formatDurationFallback({ milliseconds }, style);
      return formatSignedDuration(formatted, isNegative);
    }
    if (absMs < MILLISECONDS_PER_MINUTE) {
      const formatted = formatDurationFallback({ seconds }, style);
      return formatSignedDuration(formatted, isNegative);
    }
    if (absMs < MILLISECONDS_PER_HOUR) {
      const formatted = formatDurationFallback({ minutes, seconds }, style);
      return formatSignedDuration(formatted, isNegative);
    }
    const formatted = formatDurationFallback({ hours, minutes }, style);
    return formatSignedDuration(formatted, isNegative);
  }

  if (absMs < MILLISECONDS_PER_SECOND) {
    const dtf = new Intl.DurationFormat(locale, {
      millisecondsDisplay: "always",
      style,
    });
    const formatted = dtf.format({ milliseconds });
    return formatSignedDuration(formatted, isNegative);
  }

  if (absMs < MILLISECONDS_PER_MINUTE) {
    const dtf = new Intl.DurationFormat(locale, { style });
    const formatted = dtf.format({ seconds });
    return formatSignedDuration(formatted, isNegative);
  }

  if (absMs < MILLISECONDS_PER_HOUR) {
    const dtf = new Intl.DurationFormat(locale, { style });
    const formatted = dtf.format({ minutes, seconds });
    return formatSignedDuration(formatted, isNegative);
  }

  const dtf = new Intl.DurationFormat(locale, { style });
  const formatted = dtf.format({ hours, minutes });
  return formatSignedDuration(formatted, isNegative);
}
