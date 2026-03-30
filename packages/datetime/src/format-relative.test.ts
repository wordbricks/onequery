import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./format-relative";

describe("formatRelativeTime", () => {
  const NOW = new Date("2024-06-15T12:00:00Z");

  it("should format seconds ago", () => {
    const date = new Date("2024-06-15T11:59:30Z"); // 30 seconds ago
    const result = formatRelativeTime(date, "en-US", NOW);
    expect(result).toBe("30 seconds ago");
  });

  it("should format minutes ago", () => {
    const date = new Date("2024-06-15T11:55:00Z"); // 5 minutes ago
    const result = formatRelativeTime(date, "en-US", NOW);
    expect(result).toBe("5 minutes ago");
  });

  it("should format hours ago", () => {
    const date = new Date("2024-06-15T09:00:00Z"); // 3 hours ago
    const result = formatRelativeTime(date, "en-US", NOW);
    expect(result).toBe("3 hours ago");
  });

  it("should format days ago", () => {
    const date = new Date("2024-06-13T12:00:00Z"); // 2 days ago
    const result = formatRelativeTime(date, "en-US", NOW);
    expect(result).toBe("2 days ago");
  });

  it("should format weeks ago", () => {
    const date = new Date("2024-06-01T12:00:00Z"); // 2 weeks ago
    const result = formatRelativeTime(date, "en-US", NOW);
    expect(result).toBe("2 weeks ago");
  });

  it("should format months ago", () => {
    const date = new Date("2024-04-15T12:00:00Z"); // 2 months ago
    const result = formatRelativeTime(date, "en-US", NOW);
    expect(result).toBe("2 months ago");
  });

  it("should format years ago", () => {
    const date = new Date("2022-06-15T12:00:00Z"); // 2 years ago
    const result = formatRelativeTime(date, "en-US", NOW);
    expect(result).toBe("2 years ago");
  });

  it("should format future dates", () => {
    const date = new Date("2024-06-15T15:00:00Z"); // 3 hours in future
    const result = formatRelativeTime(date, "en-US", NOW);
    expect(result).toBe("in 3 hours");
  });

  it("should handle 'yesterday' and 'tomorrow' with numeric: auto", () => {
    const yesterday = new Date("2024-06-14T12:00:00Z");
    const result = formatRelativeTime(yesterday, "en-US", NOW);
    expect(result).toBe("yesterday");
  });

  it("should accept string date input", () => {
    const result = formatRelativeTime("2024-06-15T11:55:00Z", "en-US", NOW);
    expect(result).toBe("5 minutes ago");
  });

  it("should return a fallback for invalid dates", () => {
    const result = formatRelativeTime("not-a-date", "en-US", NOW);
    expect(result).toBe("Invalid date");
  });

  it("should handle different locales", () => {
    const date = new Date("2024-06-15T11:55:00Z"); // 5 minutes ago
    const result = formatRelativeTime(date, "ko-KR", NOW);
    expect(result).toMatch(/5분 전/);
  });

  it("should use current time when now is not provided", () => {
    // Test that the function works without the 'now' parameter
    const recentDate = new Date(Date.now() - 60_000); // 1 minute ago
    const result = formatRelativeTime(recentDate, "en-US");
    expect(result).toBe("1 minute ago");
  });
});
