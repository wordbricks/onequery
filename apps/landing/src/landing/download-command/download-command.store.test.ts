import { describe, expect, it, vi } from "vitest";

import {
  createDownloadCommandStore,
  getInstallMethod,
  readSelectedInstallMethod,
} from "./download-command.store";
import type { DownloadCommandCopyInput } from "./download-command.store";

const COPY_FEEDBACK_RESET_DELAY_MS = 100;

function createDeferred<T>() {
  let rejectDeferred!: (error: unknown) => void;
  let resolveDeferred!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
}

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("createDownloadCommandStore", () => {
  it("keeps copy feedback attached to the command that actually finished", async () => {
    const copyFinished = createDeferred<void>();
    const copyInputs: DownloadCommandCopyInput[] = [];
    const downloadCommandStore = createDownloadCommandStore({
      copyCommand: async (input) => {
        copyInputs.push(input);
        await copyFinished.promise;

        return {
          label: input.label,
        };
      },
      copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
    });

    downloadCommandStore.selectMethod("Homebrew");
    const copyPromise = downloadCommandStore.copy();

    expect(downloadCommandStore.$downloadCommandState.get().isCopying).toBe(
      true
    );

    downloadCommandStore.selectMethod("npm");
    copyFinished.resolve();
    await copyPromise;

    const copiedState = downloadCommandStore.$downloadCommandState.get();

    expect(copyInputs[0]).toEqual({
      command: getInstallMethod("Homebrew").command,
      label: "Homebrew",
    });
    expect(copiedState.copiedMethodLabel).toBe("Homebrew");
    expect(readSelectedInstallMethod(copiedState).label).toBe("npm");
  });

  it("returns to idle without copy feedback when the copy action fails", async () => {
    const copyFinished = createDeferred<void>();
    const downloadCommandStore = createDownloadCommandStore({
      copyCommand: async (input) => {
        await copyFinished.promise;

        return {
          label: input.label,
        };
      },
      copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
    });

    const copyPromise = downloadCommandStore.copy();

    expect(downloadCommandStore.$downloadCommandState.get().isCopying).toBe(
      true
    );

    copyFinished.reject(new Error("Clipboard unavailable"));
    await copyPromise;

    const idleState = downloadCommandStore.$downloadCommandState.get();

    expect(idleState.isCopying).toBe(false);
    expect(idleState.copiedMethodLabel).toBeNull();
  });

  it("clears copied feedback after the reset delay", async () => {
    vi.useFakeTimers();

    try {
      const downloadCommandStore = createDownloadCommandStore({
        copyCommand: async (input) => ({
          label: input.label,
        }),
        copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
      });

      await downloadCommandStore.copy();

      expect(
        downloadCommandStore.$downloadCommandState.get().copiedMethodLabel
      ).toBe("npm");

      await advanceTimersByTime(COPY_FEEDBACK_RESET_DELAY_MS);

      expect(
        downloadCommandStore.$downloadCommandState.get().copiedMethodLabel
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
