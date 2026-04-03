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
  it("returns a sorted array of timezone strings", () => {
    const timezones = getAllTimezones();
    expect(Array.isArray(timezones)).toBe(true);
    expect(timezones.length).toBeGreaterThan(100);
    const sorted = [...timezones].sort();
    expect(timezones).toEqual(sorted);
  });
});

describe("getBrowserTimezone", () => {
  it("returns a valid IANA timezone string", () => {
    const timezone = getBrowserTimezone();
    expect(typeof timezone).toBe("string");
    expect(timezone.length).toBeGreaterThan(0);
    expect(() => {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    }).not.toThrow();
  });
});

describe("getTimezoneOffset", () => {
  it.each([
    {
      expected: "+00:00",
      label: "returns UTC offset for UTC",
      timezone: "UTC",
    },
    {
      expected: /^[+-]\d{2}:\d{2}$/,
      label: "formats whole-hour offsets",
      timezone: "America/New_York",
    },
    {
      expected: /^[+-]\d{2}:30$/,
      label: "formats half-hour offsets",
      timezone: "Asia/Kolkata",
    },
  ])("$label", ({ expected, timezone }) => {
    const offset = getTimezoneOffset(timezone);
    if (expected instanceof RegExp) {
      expect(offset).toMatch(expected);
      return;
    }
    expect(offset).toBe(expected);
  });
});

describe("formatTimezoneLabel", () => {
  it.each([
    {
      expected: "(GMT+00:00) UTC",
      label: "formats UTC correctly",
      timezone: "UTC",
    },
    {
      expected: /\(GMT[+-]\d{2}:\d{2}\)/,
      label: "includes the GMT offset",
      timezone: "Asia/Tokyo",
      text: "Asia/Tokyo",
    },
    {
      expected: "America/New York",
      label: "replaces underscores with spaces",
      timezone: "America/New_York",
    },
  ])("$label", ({ expected, text, timezone }) => {
    const label = formatTimezoneLabel(timezone);
    if (expected instanceof RegExp) {
      expect(label).toMatch(expected);
    } else {
      expect(label).toContain(expected);
    }
    if (text) {
      expect(label).toContain(text);
    }
  });
});

describe.each([
  ["timezoneToUtc", timezoneToUtc],
  ["utcToTimezone", utcToTimezone],
] as const)("timezone conversions", (_, convertTime) => {
  it("keeps UTC times unchanged", () => {
    expect(convertTime("09:00", "UTC")).toBe("09:00");
  });
});
