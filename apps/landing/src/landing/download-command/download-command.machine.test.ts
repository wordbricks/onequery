import { describe, expect, it, vi } from "vitest";
import { createActor, fromPromise, waitFor } from "xstate";
import { getShortestPaths } from "xstate/graph";

import {
  createDownloadCommandMachine,
  getInstallMethod,
  readSelectedInstallMethod,
} from "./download-command.machine";
import type {
  DownloadCommandCopyInput,
  DownloadCommandCopyOutput,
} from "./download-command.machine";

const COPY_FEEDBACK_RESET_DELAY_MS = 100;

function buildDownloadCommandShortestPaths() {
  return getShortestPaths(
    createDownloadCommandMachine({
      copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
    }),
    {
      events: (state) => {
        if (state.matches("copying")) {
          return [
            {
              type: "downloadCommand/methodSelected" as const,
              label: "npm" as const,
            },
          ];
        }

        return [
          {
            type: "downloadCommand/methodSelected" as const,
            label: "Homebrew" as const,
          },
          {
            type: "downloadCommand/copyRequested" as const,
          },
        ];
      },
      filterEvents: (state, event) => state.can(event),
      stopWhen: (state) => state.matches("copying"),
    }
  );
}

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

function describeGraphPath(path: {
  state: { value: unknown };
  steps: Array<{ event: { type: string } }>;
}) {
  return `${JSON.stringify(path.state.value)} via ${path.steps
    .map((step) => step.event.type)
    .join(" -> ")}`;
}

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("createDownloadCommandMachine", () => {
  it("keeps copy feedback attached to the command that actually finished", async () => {
    const copyFinished = createDeferred<void>();
    const copyInputs: DownloadCommandCopyInput[] = [];
    const actor = createActor(
      createDownloadCommandMachine({
        copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
      }).provide({
        actors: {
          copyCommand: fromPromise<
            DownloadCommandCopyOutput,
            DownloadCommandCopyInput
          >(async ({ input }) => {
            copyInputs.push(input);
            await copyFinished.promise;

            return {
              label: input.label,
            };
          }),
        },
      })
    );

    actor.start();
    actor.send({
      type: "downloadCommand/methodSelected",
      label: "Homebrew",
    });
    actor.send({ type: "downloadCommand/copyRequested" });

    await waitFor(actor, (snapshot) => snapshot.matches("copying"));

    actor.send({
      type: "downloadCommand/methodSelected",
      label: "npm",
    });
    copyFinished.resolve();

    const copied = await waitFor(actor, (snapshot) =>
      snapshot.matches("copied")
    );

    expect(copyInputs[0]).toEqual({
      command: getInstallMethod("Homebrew").command,
      label: "Homebrew",
    });
    expect(copied.context.copiedMethodLabel).toBe("Homebrew");
    expect(readSelectedInstallMethod(copied).label).toBe("npm");
  });

  it("returns to idle without copy feedback when the copy actor fails", async () => {
    const copyFinished = createDeferred<void>();
    const actor = createActor(
      createDownloadCommandMachine({
        copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
      }).provide({
        actors: {
          copyCommand: fromPromise<
            DownloadCommandCopyOutput,
            DownloadCommandCopyInput
          >(async ({ input }) => {
            await copyFinished.promise;

            return {
              label: input.label,
            };
          }),
        },
      })
    );

    actor.start();
    actor.send({ type: "downloadCommand/copyRequested" });

    await waitFor(actor, (snapshot) => snapshot.matches("copying"));

    copyFinished.reject(new Error("Clipboard unavailable"));

    const idle = await waitFor(actor, (snapshot) => snapshot.matches("idle"));

    expect(idle.context.copiedMethodLabel).toBeNull();
  });

  it("clears copied feedback after the reset delay", async () => {
    vi.useFakeTimers();

    try {
      const actor = createActor(
        createDownloadCommandMachine({
          copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
        })
      );

      actor.start();
      actor.send({ type: "downloadCommand/copyRequested" });

      const copied = await waitFor(actor, (snapshot) =>
        snapshot.matches("copied")
      );

      expect(copied.context.copiedMethodLabel).toBe("Install script");

      const idlePromise = waitFor(actor, (snapshot) =>
        snapshot.matches("idle")
      );

      await advanceTimersByTime(COPY_FEEDBACK_RESET_DELAY_MS);
      const idle = await idlePromise;

      expect(idle.context.copiedMethodLabel).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("graph coverage", () => {
    for (const path of buildDownloadCommandShortestPaths()) {
      it(describeGraphPath(path), () => {
        if (path.state.matches("idle")) {
          expect(path.state.context.copiedMethodLabel).toBeNull();
          expect(readSelectedInstallMethod(path.state).command).toBe(
            getInstallMethod(readSelectedInstallMethod(path.state).label)
              .command
          );
          return;
        }

        expect(path.state.matches("copying")).toBe(true);
        expect(readSelectedInstallMethod(path.state).command).toBe(
          getInstallMethod(readSelectedInstallMethod(path.state).label).command
        );
      });
    }
  });
});
