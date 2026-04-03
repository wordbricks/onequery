import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatTime,
  formatUtcDateTimeLabel,
} from "./format-date";

describe("formatDate", () => {
  const testDate = new Date("2024-06-15T14:30:00Z");

  it.each([
    {
      input: testDate,
      label: "formats the default style",
      locale: "en-US",
      expected: "Jun 15, 2024",
    },
    {
      input: testDate,
      label: "formats the short style",
      locale: "en-US",
      style: "short" as const,
      expected: "6/15/24",
    },
    {
      input: testDate,
      label: "formats the long style",
      locale: "en-US",
      style: "long" as const,
      expected: "June 15, 2024",
    },
    {
      input: testDate,
      label: "formats the full style with weekday text",
      locale: "en-US",
      style: "full" as const,
      expected: /Saturday, June 15, 2024/,
    },
    {
      input: "2024-06-15T14:30:00Z",
      label: "accepts string date input",
      locale: "en-US",
      expected: "Jun 15, 2024",
    },
    {
      input: testDate,
      label: "honors locale-specific formatting",
      locale: "ko-KR",
      expected: /2024.*6.*15/,
    },
  ])("$label", ({ expected, input, locale, style }) => {
    const result = formatDate(input, locale, style);
    if (expected instanceof RegExp) {
      expect(result).toMatch(expected);
      return;
    }
    expect(result).toBe(expected);
  });
});

describe("formatDateTime", () => {
  const testDate = new Date("2024-06-15T14:30:00Z");
  const formatDateTimeCases: Array<{
    expected: RegExp[];
    input: Date | string;
    label: string;
    locale: string;
    options?: Intl.DateTimeFormatOptions;
  }> = [
    {
      label: "formats the default date and time",
      expected: [/Jun 15, 2024/, /\d{1,2}:\d{2}/],
      input: testDate,
      locale: "en-US",
    },
    {
      label: "formats with custom options",
      expected: [/Saturday/, /June 15, 2024/],
      input: testDate,
      locale: "en-US",
      options: {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "long",
        weekday: "long",
        year: "numeric",
      },
    },
  ];

  it.each(formatDateTimeCases)(
    "$label",
    ({ expected, input, locale, options }) => {
      const result = formatDateTime(input, locale, options);
      for (const pattern of expected) {
        expect(result).toMatch(pattern);
      }
    }
  );
});

describe("formatTime", () => {
  const testDate = new Date("2024-06-15T14:30:45Z");

  it.each([
    {
      expected: /\d{1,2}:\d{2}\s*(AM|PM)?/,
      input: testDate,
      label: "formats the default style without seconds",
      locale: "en-US",
    },
    {
      expected: /\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?/,
      input: testDate,
      label: "formats the medium style with seconds",
      locale: "en-US",
      style: "medium" as const,
    },
  ])("$label", ({ expected, input, locale, style }) => {
    const result = formatTime(input, locale, style);
    expect(result).toMatch(expected);
  });
});

describe("formatUtcDateTimeLabel", () => {
  const testDate = new Date("2024-06-15T14:30:45Z");
  const utcLabelCases: Array<{
    label: string;
    locale: string;
    options?: Intl.DateTimeFormatOptions;
  }> = [
    {
      label: "appends UTC to the default label",
      locale: "en-US",
    },
    {
      label: "ignores timeZoneName options without throwing",
      locale: "en-US",
      options: {
        dateStyle: "medium",
        timeStyle: "short",
        timeZoneName: "short",
      },
    },
  ];

  it.each(utcLabelCases)("$label", ({ locale, options }) => {
    const result = formatUtcDateTimeLabel(testDate, locale, options);
    expect(result.endsWith(" UTC")).toBe(true);
  });
});
