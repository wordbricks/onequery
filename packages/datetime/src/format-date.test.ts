import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatTime,
  formatUtcDateTimeLabel,
} from "./format-date";

describe("formatDate", () => {
  const testDate = new Date("2024-06-15T14:30:00Z");

  it("should format date with default style", () => {
    const result = formatDate(testDate, "en-US");
    expect(result).toBe("Jun 15, 2024");
  });

  it("should format date with short style", () => {
    const result = formatDate(testDate, "en-US", "short");
    expect(result).toBe("6/15/24");
  });

  it("should format date with long style", () => {
    const result = formatDate(testDate, "en-US", "long");
    expect(result).toBe("June 15, 2024");
  });

  it("should format date with full style", () => {
    const result = formatDate(testDate, "en-US", "full");
    // Full includes weekday
    expect(result).toMatch(/Saturday, June 15, 2024/);
  });

  it("should accept string date input", () => {
    const result = formatDate("2024-06-15T14:30:00Z", "en-US");
    expect(result).toBe("Jun 15, 2024");
  });

  it("should handle different locales", () => {
    const result = formatDate(testDate, "ko-KR");
    expect(result).toMatch(/2024.*6.*15/);
  });
});

describe("formatDateTime", () => {
  const testDate = new Date("2024-06-15T14:30:00Z");

  it("should format date and time with default options", () => {
    const result = formatDateTime(testDate, "en-US");
    // Should include both date and time components
    expect(result).toMatch(/Jun 15, 2024/);
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("should format with custom options", () => {
    const result = formatDateTime(testDate, "en-US", {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "long",
      weekday: "long",
      year: "numeric",
    });
    expect(result).toMatch(/Saturday/);
    expect(result).toMatch(/June 15, 2024/);
  });

  it("should accept string date input", () => {
    const result = formatDateTime("2024-06-15T14:30:00Z", "en-US");
    expect(result).toMatch(/Jun 15, 2024/);
  });
});

describe("formatTime", () => {
  const testDate = new Date("2024-06-15T14:30:45Z");

  it("should format time with default style", () => {
    const result = formatTime(testDate, "en-US");
    // Default is short: no seconds
    expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)?/);
  });

  it("should format time with medium style (includes seconds)", () => {
    const result = formatTime(testDate, "en-US", "medium");
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?/);
  });

  it("should accept string date input", () => {
    const result = formatTime("2024-06-15T14:30:45Z", "en-US");
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("formatUtcDateTimeLabel", () => {
  const testDate = new Date("2024-06-15T14:30:45Z");

  it("should append UTC to the formatted label", () => {
    const result = formatUtcDateTimeLabel(testDate, "en-US");
    expect(result.endsWith(" UTC")).toBe(true);
  });

  it("should ignore timeZoneName options to avoid Intl errors", () => {
    const result = formatUtcDateTimeLabel(testDate, "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short",
    });
    expect(result.endsWith(" UTC")).toBe(true);
  });
});
