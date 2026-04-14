import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { createFailedConnectionTest } from "./connection-test-outcome";
import { createHttpTester } from "./create-http-tester";

describe("createHttpTester", () => {
  it("returns a success result with measured latency", async () => {
    const tester = createHttpTester({
      probe: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await tester({ token: "abc" }, 2);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.message).toMatch(/^Connection successful \(\d+ms\)$/u);
  });

  it("delegates failures to the custom parser", async () => {
    const parsedFailure = Result.err(
      createFailedConnectionTest({
        detail: "bad creds",
        latencyMs: 12,
        message: "Authentication failed",
      })
    );
    const parseError = vi.fn().mockReturnValue(parsedFailure);
    const tester = createHttpTester({
      parseError,
      probe: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const result = await tester({ token: "abc" }, 3);

    expect(parseError).toHaveBeenCalled();
    expect(result).toBe(parseError.mock.results[0]?.value);
  });
});
