import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./format-relative";

describe("formatRelativeTime", () => {
  const NOW = new Date("2024-06-15T12:00:00Z");

  it.each([
    {
      expected: "30 seconds ago",
      input: new Date("2024-06-15T11:59:30Z"),
      label: "formats seconds ago",
    },
    {
      expected: "5 minutes ago",
      input: new Date("2024-06-15T11:55:00Z"),
      label: "formats minutes ago",
    },
    {
      expected: "3 hours ago",
      input: new Date("2024-06-15T09:00:00Z"),
      label: "formats hours ago",
    },
    {
      expected: "2 days ago",
      input: new Date("2024-06-13T12:00:00Z"),
      label: "formats days ago",
    },
    {
      expected: "2 weeks ago",
      input: new Date("2024-06-01T12:00:00Z"),
      label: "formats weeks ago",
    },
    {
      expected: "2 months ago",
      input: new Date("2024-04-15T12:00:00Z"),
      label: "formats months ago",
    },
    {
      expected: "2 years ago",
      input: new Date("2022-06-15T12:00:00Z"),
      label: "formats years ago",
    },
    {
      expected: "in 3 hours",
      input: new Date("2024-06-15T15:00:00Z"),
      label: "formats future dates",
    },
    {
      expected: "yesterday",
      input: new Date("2024-06-14T12:00:00Z"),
      label: "uses numeric auto for day-relative labels",
    },
    {
      expected: "5 minutes ago",
      input: "2024-06-15T11:55:00Z",
      label: "accepts string date input",
    },
    {
      expected: "Invalid date",
      input: "not-a-date",
      label: "returns a fallback for invalid dates",
    },
  ])("$label", ({ expected, input }) => {
    const result = formatRelativeTime(input, "en-US", NOW);
    expect(result).toBe(expected);
  });

  it("uses current time when now is not provided", () => {
    const recentDate = new Date(Date.now() - 60_000);
    const result = formatRelativeTime(recentDate, "en-US");
    expect(result).toBe("1 minute ago");
  });

  it("handles locale-specific output", () => {
    const result = formatRelativeTime(
      new Date("2024-06-15T11:55:00Z"),
      "ko-KR",
      NOW
    );
    expect(result).toMatch(/5분 전/);
  });
});
