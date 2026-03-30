import { describe, expect, it } from "vitest";

import { stringToBoolean } from "@/boolean";

describe("stringToBoolean", () => {
  it("decodes true/false strings", () => {
    expect(stringToBoolean.decode("true")).toBe(true);
    expect(stringToBoolean.decode("false")).toBe(false);
  });

  it("encodes booleans to strings", () => {
    expect(stringToBoolean.encode(true)).toBe("true");
    expect(stringToBoolean.encode(false)).toBe("false");
  });
});
