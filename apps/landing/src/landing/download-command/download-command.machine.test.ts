import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import { getPathsFromEvents, getShortestPaths } from "xstate/graph";

import {
  createDownloadCommandMachine,
  getInstallMethod,
  readSelectedInstallMethod,
} from "./download-command.machine";

const COPY_FEEDBACK_RESET_DELAY_MS = 100;

function buildDownloadCommandShortestPaths() {
  return getShortestPaths(
    createDownloadCommandMachine({
      copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
    }),
    {
      events: (state) => {
        const pendingCopyRequest = state.context.pendingCopyRequest;

        if (pendingCopyRequest !== null) {
          return [
            {
              type: "downloadCommand/methodSelected" as const,
              label: "npm" as const,
            },
            {
              type: "downloadCommand/copySucceeded" as const,
              label: pendingCopyRequest.label,
              requestId: pendingCopyRequest.requestId,
            },
            {
              type: "downloadCommand/copyFailed" as const,
              requestId: pendingCopyRequest.requestId,
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
      stopWhen: (state) =>
        state.matches("copied") ||
        (state.matches("idle") && state.context.nextCopyRequestId > 1),
    }
  );
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
  it("keeps copy feedback attached to the command that actually finished", () => {
    const [path] = getPathsFromEvents(
      createDownloadCommandMachine({
        copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
      }),
      [
        {
          type: "downloadCommand/methodSelected",
          label: "Homebrew",
        },
        {
          type: "downloadCommand/copyRequested",
        },
        {
          type: "downloadCommand/methodSelected",
          label: "npm",
        },
        {
          type: "downloadCommand/copySucceeded",
          label: "Homebrew",
          requestId: 1,
        },
      ]
    );

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the copy success flow");
    }

    expect(path.state.matches("copied")).toBe(true);
    expect(path.state.context.copiedMethodLabel).toBe("Homebrew");
    expect(readSelectedInstallMethod(path.state).label).toBe("npm");
  });

  it("clears copied feedback after the reset delay", async () => {
    vi.useFakeTimers();

    const actor = createActor(
      createDownloadCommandMachine({
        copyFeedbackResetDelayMs: COPY_FEEDBACK_RESET_DELAY_MS,
      })
    );

    actor.start();
    actor.send({ type: "downloadCommand/copyRequested" });
    actor.send({
      type: "downloadCommand/copySucceeded",
      label: "Install script",
      requestId: 1,
    });

    expect(actor.getSnapshot().matches("copied")).toBe(true);

    await advanceTimersByTime(COPY_FEEDBACK_RESET_DELAY_MS);

    expect(actor.getSnapshot().matches("idle")).toBe(true);
    expect(actor.getSnapshot().context.copiedMethodLabel).toBeNull();

    vi.useRealTimers();
  });

  describe("graph coverage", () => {
    for (const path of buildDownloadCommandShortestPaths()) {
      it(describeGraphPath(path), () => {
        const { pendingCopyRequest } = path.state.context;

        if (path.state.matches("idle")) {
          expect(path.state.context.copiedMethodLabel).toBeNull();
          expect(pendingCopyRequest).toBeNull();
          return;
        }

        if (path.state.matches("copying")) {
          expect(pendingCopyRequest).not.toBeNull();
          expect(pendingCopyRequest?.command).toBe(
            getInstallMethod(pendingCopyRequest?.label ?? "Install script")
              .command
          );
          return;
        }

        expect(path.state.matches("copied")).toBe(true);
        expect(path.state.context.copiedMethodLabel).not.toBeNull();
        expect(pendingCopyRequest).toBeNull();
      });
    }
  });
});
