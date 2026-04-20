import { describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";

import {
  createDownloadCommandMachine,
  readSelectedInstallMethod,
} from "./download-command.machine";

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("createDownloadCommandMachine", () => {
  it("keeps copy feedback attached to the command that actually finished", async () => {
    vi.useFakeTimers();

    let releaseCopy: (() => void) | undefined;

    const actor = createActor(
      createDownloadCommandMachine({
        copyFeedbackResetDelayMs: 100,
        copyCommand: ({ label }) =>
          new Promise<void>((resolve) => {
            releaseCopy = resolve;
          }).then(() => label),
      })
    );

    actor.start();

    actor.send({
      type: "downloadCommand/methodSelected",
      label: "Homebrew",
    });
    actor.send({ type: "downloadCommand/copyRequested" });
    actor.send({
      type: "downloadCommand/methodSelected",
      label: "npm",
    });

    releaseCopy?.();
    await waitFor(actor, (snapshot) => snapshot.matches("copied"));

    expect(actor.getSnapshot().context.copiedMethodLabel).toBe("Homebrew");
    expect(readSelectedInstallMethod(actor.getSnapshot()).label).toBe("npm");

    await advanceTimersByTime(100);

    expect(actor.getSnapshot().matches("idle")).toBe(true);
    expect(actor.getSnapshot().context.copiedMethodLabel).toBeNull();

    vi.useRealTimers();
  });
});
