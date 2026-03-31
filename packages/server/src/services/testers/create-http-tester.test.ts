import { describe, expect, it, vi } from "vitest";

import { createHttpTester } from "./create-http-tester";

describe("createHttpTester", () => {
  it("returns a success result with measured latency", async () => {
    const tester = createHttpTester({
      probe: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await tester({ token: "abc" }, 2);

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/^Connection successful \(\d+ms\)$/u);
  });

  it("delegates failures to the custom parser", async () => {
    const parseError = vi.fn().mockReturnValue({
      error: "bad creds",
      latencyMs: 12,
      message: "Authentication failed",
      success: false,
    });
    const tester = createHttpTester({
      parseError,
      probe: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const result = await tester({ token: "abc" }, 3);

    expect(parseError).toHaveBeenCalled();
    expect(result).toEqual({
      error: "bad creds",
      latencyMs: 12,
      message: "Authentication failed",
      success: false,
    });
  });
});
