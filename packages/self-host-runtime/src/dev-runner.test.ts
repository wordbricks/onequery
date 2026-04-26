import type { ChildProcess } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { waitForBundledRuntimeResult } from "./dev-runner";

function createRunningBuilder(): ChildProcess {
  return {
    exitCode: null,
    signalCode: null,
  } as ChildProcess;
}

describe("waitForBundledRuntimeResult", () => {
  it("returns a wait error when the runtime bundle cannot be stated", async () => {
    const bundledRuntimePath = "/runtime/dist/node-entry.js";
    const cause = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const statBundledRuntimePath = vi.fn(() => {
      throw cause;
    });

    const result = await waitForBundledRuntimeResult({
      buildStartedAtMs: Date.now(),
      builder: createRunningBuilder(),
      bundledRuntimePath,
      statBundledRuntimePath,
    });

    expect(statBundledRuntimePath).toHaveBeenCalledWith(bundledRuntimePath);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected stat failure to return a wait error");
    }
    expect(result.error).toMatchObject({
      _tag: "BundledRuntimeWaitError",
      bundledRuntimePath,
      cause,
    });
    expect(result.error.message).toContain(
      `Failed to inspect bundled self-host runtime entry at ${bundledRuntimePath}.`
    );
    expect(result.error.message).toContain("permission denied");
  });
});
