import { describe, expect, it } from "vitest";

import { dateLikeToDate } from "@/date";

describe("dateLikeToDate", () => {
  it("decodes ISO datetime strings to Date", () => {
    const value = dateLikeToDate.decode("2026-04-20T09:00:00.000Z");

    expect(value).toBeInstanceOf(Date);
    expect(value.toISOString()).toBe("2026-04-20T09:00:00.000Z");
  });

  it("passes through Date inputs without re-wrapping them", () => {
    const input = new Date("2026-04-20T09:00:00.000Z");

    expect(dateLikeToDate.decode(input)).toBe(input);
  });

  it("encodes Date outputs back to ISO datetime strings", () => {
    expect(dateLikeToDate.encode(new Date("2026-04-20T09:00:00.000Z"))).toBe(
      "2026-04-20T09:00:00.000Z"
    );
  });
});
