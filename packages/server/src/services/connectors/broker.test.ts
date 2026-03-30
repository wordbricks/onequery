import { describe, expect, it } from "vitest";

import { readBearerToken } from "./broker";

describe("connector broker auth parsing", () => {
  it("accepts a standard bearer token", () => {
    expect(readBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("rejects bearer headers with extra segments", () => {
    expect(readBearerToken("Bearer abc123 extra")).toBeNull();
  });

  it("rejects bearer tokens with control characters", () => {
    expect(readBearerToken("Bearer abc\u0000def")).toBeNull();
  });
});
