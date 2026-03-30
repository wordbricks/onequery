// Type definitions for Intl.DurationFormat
// This API is available in modern browsers and Bun but TypeScript doesn't ship types yet

declare namespace Intl {
  interface DurationFormatOptions {
    style?: "long" | "short" | "narrow" | "digital";
    years?: "long" | "short" | "narrow";
    yearsDisplay?: "always" | "auto";
    months?: "long" | "short" | "narrow";
    monthsDisplay?: "always" | "auto";
    weeks?: "long" | "short" | "narrow";
    weeksDisplay?: "always" | "auto";
    days?: "long" | "short" | "narrow";
    daysDisplay?: "always" | "auto";
    hours?: "long" | "short" | "narrow" | "numeric" | "2-digit";
    hoursDisplay?: "always" | "auto";
    minutes?: "long" | "short" | "narrow" | "numeric" | "2-digit";
    minutesDisplay?: "always" | "auto";
    seconds?: "long" | "short" | "narrow" | "numeric" | "2-digit";
    secondsDisplay?: "always" | "auto";
    milliseconds?: "long" | "short" | "narrow" | "numeric";
    millisecondsDisplay?: "always" | "auto";
    microseconds?: "long" | "short" | "narrow" | "numeric";
    microsecondsDisplay?: "always" | "auto";
    nanoseconds?: "long" | "short" | "narrow" | "numeric";
    nanosecondsDisplay?: "always" | "auto";
    fractionalDigits?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  }

  interface DurationInput {
    years?: number;
    months?: number;
    weeks?: number;
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    milliseconds?: number;
    microseconds?: number;
    nanoseconds?: number;
  }

  class DurationFormat {
    constructor(locales?: string | string[], options?: DurationFormatOptions);
    format(duration: DurationInput): string;
    formatToParts(duration: DurationInput): { type: string; value: string }[];
    resolvedOptions(): DurationFormatOptions & { locale: string };
  }
}
