import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatTime,
  formatUtcDateTimeLabel,
} from "./format-date";

describe("formatDate", () => {
  const testDate = new Date("2024-06-15T14:30:00Z");

  it("matches stable date format snapshots", () => {
    expect({
      "default style": formatDate(testDate, "en-US"),
      "long style": formatDate(testDate, "en-US", "long"),
      "short style": formatDate(testDate, "en-US", "short"),
      "string input": formatDate("2024-06-15T14:30:00Z", "en-US"),
    }).toMatchSnapshot();
  });

  it("formats the full style with weekday text", () => {
    expect(formatDate(testDate, "en-US", "full")).toMatch(
      /Saturday, June 15, 2024/
    );
  });

  it("honors locale-specific formatting", () => {
    expect(formatDate(testDate, "ko-KR")).toMatch(/2024.*6.*15/);
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
  it("matches UTC label snapshots", () => {
    expect({
      default: formatUtcDateTimeLabel(testDate, "en-US"),
      "timeZoneName stripped": formatUtcDateTimeLabel(testDate, "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZoneName: "short",
      }),
    }).toMatchSnapshot();
  });
});
