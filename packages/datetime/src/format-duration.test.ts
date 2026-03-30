import { describe, expect, it } from "vitest";

import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("should format milliseconds for very short durations", () => {
    const result = formatDuration(500, "en-US");
    // Fallback: "500ms", Intl: "500ms" or similar
    expect(result).toMatch(/500\s?ms/);
  });

  it("should format seconds for sub-minute durations", () => {
    const result = formatDuration(5000, "en-US");
    // Fallback: "5s", Intl: "5s" or similar
    expect(result).toMatch(/5\s?s/);
  });

  it("should format seconds with decimal-like precision", () => {
    const result = formatDuration(30_000, "en-US");
    expect(result).toMatch(/30\s?s/);
  });

  it("should format minutes and seconds for sub-hour durations", () => {
    const result = formatDuration(90_000, "en-US"); // 1m 30s
    // Fallback: "1m 30s", Intl: "1m 30s" or "1 min 30 sec"
    expect(result).toMatch(/1.*m.*30.*s/);
  });

  it("should format minutes and seconds", () => {
    const result = formatDuration(330_000, "en-US"); // 5m 30s
    expect(result).toMatch(/5.*m.*30.*s/);
  });

  it("should format hours and minutes for longer durations", () => {
    const result = formatDuration(5_400_000, "en-US"); // 1h 30m
    expect(result).toMatch(/1.*h.*30.*m/);
  });

  it("should format multiple hours", () => {
    const result = formatDuration(7_200_000, "en-US"); // 2h
    expect(result).toMatch(/2.*h/);
  });

  it("should use long style when specified", () => {
    const result = formatDuration(90_000, "en-US", "long"); // 1m 30s
    // Fallback: "1 minute, 30 seconds"
    expect(result).toMatch(/1.*minute.*30.*second/);
  });

  it("should use short style when specified", () => {
    const result = formatDuration(90_000, "en-US", "short"); // 1m 30s
    // Fallback: "1 min, 30 sec"
    expect(result).toMatch(/1.*min.*30.*sec/);
  });

  it("should handle zero milliseconds", () => {
    const result = formatDuration(0, "en-US");
    expect(result).toMatch(/0\s?ms/);
  });

  it("should handle different locales for narrow style", () => {
    // Even with ko-KR locale, fallback returns English format
    const result = formatDuration(90_000, "ko-KR");
    // Either Korean format or fallback English format
    expect(result.length).toBeGreaterThan(0);
  });
});
