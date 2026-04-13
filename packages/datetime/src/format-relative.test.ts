import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./format-relative";

describe("formatRelativeTime", () => {
  const NOW = new Date("2024-06-15T12:00:00Z");

  it("matches relative-time snapshots for fixed inputs", () => {
    expect({
      "days ago": formatRelativeTime(
        new Date("2024-06-13T12:00:00Z"),
        "en-US",
        NOW
      ),
      "future dates": formatRelativeTime(
        new Date("2024-06-15T15:00:00Z"),
        "en-US",
        NOW
      ),
      "hours ago": formatRelativeTime(
        new Date("2024-06-15T09:00:00Z"),
        "en-US",
        NOW
      ),
      "invalid dates": formatRelativeTime("not-a-date", "en-US", NOW),
      "minutes ago": formatRelativeTime(
        new Date("2024-06-15T11:55:00Z"),
        "en-US",
        NOW
      ),
      "months ago": formatRelativeTime(
        new Date("2024-04-15T12:00:00Z"),
        "en-US",
        NOW
      ),
      "numeric auto day labels": formatRelativeTime(
        new Date("2024-06-14T12:00:00Z"),
        "en-US",
        NOW
      ),
      "seconds ago": formatRelativeTime(
        new Date("2024-06-15T11:59:30Z"),
        "en-US",
        NOW
      ),
      "weeks ago": formatRelativeTime(
        new Date("2024-06-01T12:00:00Z"),
        "en-US",
        NOW
      ),
      "years ago": formatRelativeTime(
        new Date("2022-06-15T12:00:00Z"),
        "en-US",
        NOW
      ),
    }).toMatchSnapshot();
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
