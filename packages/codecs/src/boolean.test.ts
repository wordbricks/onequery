import { describe, expect, it } from "vitest";

import { stringToBoolean } from "@/boolean";

describe("stringToBoolean", () => {
  it.each([
    ["true", true],
    ["false", false],
  ])("decodes %s to %s", (input, expected) => {
    expect(stringToBoolean.decode(input)).toBe(expected);
  });

  it.each([
    [true, "true"],
    [false, "false"],
  ])("encodes %s to %s", (input, expected) => {
    expect(stringToBoolean.encode(input)).toBe(expected);
  });
});
