import { describe, expect, it } from "vitest";

import {
  formatTimezoneLabel,
  getAllTimezones,
  getBrowserTimezone,
  getTimezoneOffset,
  timezoneToUtc,
  utcToTimezone,
} from "./timezones";

describe("getAllTimezones", () => {
  it("should return an array of timezone strings", () => {
    const timezones = getAllTimezones();
    expect(Array.isArray(timezones)).toBe(true);
    expect(timezones.length).toBeGreaterThan(100);
  });

  it("should include common IANA timezones", () => {
    const timezones = getAllTimezones();
    expect(timezones).toContain("America/New_York");
    expect(timezones).toContain("Europe/London");
    expect(timezones).toContain("Asia/Tokyo");
    expect(timezones).toContain("Asia/Seoul");
  });

  it("should return timezones in sorted order", () => {
    const timezones = getAllTimezones();
    const sorted = [...timezones].sort();
    expect(timezones).toEqual(sorted);
  });
});

describe("getBrowserTimezone", () => {
  it("should return a valid IANA timezone string", () => {
    const timezone = getBrowserTimezone();
    expect(typeof timezone).toBe("string");
    expect(timezone.length).toBeGreaterThan(0);
    // Should be a valid timezone that Intl.DateTimeFormat accepts
    // Note: In CI/server environments, this may return "UTC" which is valid
    // but not in Intl.supportedValuesOf("timeZone") list
    expect(() => {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    }).not.toThrow();
  });
});

describe("getTimezoneOffset", () => {
  it("should return UTC offset for UTC timezone", () => {
    const offset = getTimezoneOffset("UTC");
    expect(offset).toBe("+00:00");
  });

  it("should return a valid offset format", () => {
    const offset = getTimezoneOffset("America/New_York");
    // Should match format like +05:00 or -05:00
    expect(offset).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it("should handle timezones with non-integer offsets", () => {
    const offset = getTimezoneOffset("Asia/Kolkata");
    // India is +5:30
    expect(offset).toMatch(/^[+-]\d{2}:30$/);
  });
});

describe("formatTimezoneLabel", () => {
  it("should format UTC correctly", () => {
    const label = formatTimezoneLabel("UTC");
    expect(label).toBe("(GMT+00:00) UTC");
  });

  it("should replace underscores with spaces", () => {
    const label = formatTimezoneLabel("America/New_York");
    expect(label).toContain("America/New York");
  });

  it("should include GMT offset", () => {
    const label = formatTimezoneLabel("Asia/Tokyo");
    expect(label).toMatch(/\(GMT[+-]\d{2}:\d{2}\)/);
    expect(label).toContain("Asia/Tokyo");
  });
});

describe("timezoneToUtc", () => {
  it("should convert UTC time to UTC (no change)", () => {
    const result = timezoneToUtc("09:00", "UTC");
    expect(result).toBe("09:00");
  });

  it("should handle midnight correctly", () => {
    const result = timezoneToUtc("00:00", "UTC");
    expect(result).toBe("00:00");
  });
});

describe("utcToTimezone", () => {
  it("should convert UTC time to UTC (no change)", () => {
    const result = utcToTimezone("09:00", "UTC");
    expect(result).toBe("09:00");
  });

  it("should handle time format consistently", () => {
    const result = utcToTimezone("09:30", "UTC");
    expect(result).toBe("09:30");
  });
});
