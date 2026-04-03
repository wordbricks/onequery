import { describe, expect, it } from "vitest";

import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it.each([
    {
      expected: /500\s?ms/,
      label: "formats sub-second durations as milliseconds",
      ms: 500,
    },
    {
      expected: /5\s?s/,
      label: "formats sub-minute durations as seconds",
      ms: 5_000,
    },
    {
      expected: /1.*m.*30.*s/,
      label: "formats sub-hour durations as minutes and seconds",
      ms: 90_000,
    },
    {
      expected: /1.*h.*30.*m/,
      label: "formats longer durations as hours and minutes",
      ms: 5_400_000,
    },
    {
      expected: /2.*h/,
      label: "formats whole hours",
      ms: 7_200_000,
    },
    {
      expected: /1.*minute.*30.*second/,
      label: "uses long style when specified",
      ms: 90_000,
      style: "long" as const,
    },
    {
      expected: /1.*min.*30.*sec/,
      label: "uses short style when specified",
      ms: 90_000,
      style: "short" as const,
    },
  ])("$label", ({ expected, ms, style }) => {
    const result = formatDuration(ms, "en-US", style);
    expect(result).toMatch(expected);
  });
});
