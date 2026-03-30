import { describe, expect, it } from "vitest";

import { DEFAULT_LANDING_DEV_PORT, getLandingDevPort } from "./landing-config";

describe("getLandingDevPort", () => {
  it("uses the default port when the env var is missing or blank", () => {
    expect(getLandingDevPort(undefined)).toBe(DEFAULT_LANDING_DEV_PORT);
    expect(getLandingDevPort("   ")).toBe(DEFAULT_LANDING_DEV_PORT);
  });

  it("accepts well-formed port numbers", () => {
    expect(getLandingDevPort("4547")).toBe(4547);
    expect(getLandingDevPort("65535")).toBe(65535);
  });

  it("rejects malformed or out-of-range values", () => {
    expect(getLandingDevPort("4546abc")).toBe(DEFAULT_LANDING_DEV_PORT);
    expect(getLandingDevPort("-1")).toBe(DEFAULT_LANDING_DEV_PORT);
    expect(getLandingDevPort("0")).toBe(DEFAULT_LANDING_DEV_PORT);
    expect(getLandingDevPort("70000")).toBe(DEFAULT_LANDING_DEV_PORT);
  });
});
