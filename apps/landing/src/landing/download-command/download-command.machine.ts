import { assertEvent, assign, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

import {
  LANDING_COPY_FEEDBACK_RESET_DELAY_MS,
  LANDING_INSTALL_COMMANDS,
} from "../config/landing-config";

export type InstallMethod = (typeof LANDING_INSTALL_COMMANDS)[number];
export type InstallMethodLabel = InstallMethod["label"];

type PendingCopyRequest = {
  command: string;
  label: InstallMethodLabel;
  requestId: number;
};

type DownloadCommandContext = {
  copiedMethodLabel: InstallMethodLabel | null;
  pendingCopyRequest: PendingCopyRequest | null;
  nextCopyRequestId: number;
  selectedMethodLabel: InstallMethodLabel;
};

type DownloadCommandEvent =
  | {
      type: "downloadCommand/copyRequested";
    }
  | {
      type: "downloadCommand/copyFailed";
      requestId: number;
    }
  | {
      type: "downloadCommand/copySucceeded";
      label: InstallMethodLabel;
      requestId: number;
    }
  | {
      type: "downloadCommand/methodSelected";
      label: InstallMethodLabel;
    };

type DownloadCommandMachineOptions = {
  copyFeedbackResetDelayMs?: number;
};

const defaultInstallMethod = LANDING_INSTALL_COMMANDS[0];

function createInitialContext(): DownloadCommandContext {
  return {
    copiedMethodLabel: null,
    nextCopyRequestId: 1,
    pendingCopyRequest: null,
    selectedMethodLabel: defaultInstallMethod.label,
  };
}

export function getInstallMethod(label: InstallMethodLabel): InstallMethod {
  return (
    LANDING_INSTALL_COMMANDS.find((method) => method.label === label) ??
    defaultInstallMethod
  );
}

export function createDownloadCommandMachine(
  options: DownloadCommandMachineOptions = {}
) {
  const copyFeedbackResetDelayMs =
    options.copyFeedbackResetDelayMs ?? LANDING_COPY_FEEDBACK_RESET_DELAY_MS;

  return setup({
    types: {
      context: {} as DownloadCommandContext,
      events: {} as DownloadCommandEvent,
    },
    actions: {
      clearCopiedMethod: assign({
        copiedMethodLabel: () => null,
      }),
      clearPendingCopyRequest: assign({
        pendingCopyRequest: () => null,
      }),
      startCopyRequest: assign(({ context }) => {
        const installMethod = getInstallMethod(context.selectedMethodLabel);

        return {
          nextCopyRequestId: context.nextCopyRequestId + 1,
          pendingCopyRequest: {
            command: installMethod.command,
            label: installMethod.label,
            requestId: context.nextCopyRequestId,
          },
        };
      }),
      selectMethod: assign(({ event }) => {
        assertEvent(event, "downloadCommand/methodSelected");
        return {
          selectedMethodLabel: event.label,
        };
      }),
      storeCopiedMethod: assign(({ context, event }) => {
        assertEvent(event, "downloadCommand/copySucceeded");

        return {
          copiedMethodLabel:
            context.pendingCopyRequest?.requestId === event.requestId
              ? event.label
              : context.copiedMethodLabel,
        };
      }),
    },
    guards: {
      matchesPendingCopyRequest: ({ context, event }) => {
        if (
          event.type !== "downloadCommand/copyFailed" &&
          event.type !== "downloadCommand/copySucceeded"
        ) {
          return false;
        }

        return context.pendingCopyRequest?.requestId === event.requestId;
      },
    },
  }).createMachine({
    id: "downloadCommand",
    initial: "idle",
    context: createInitialContext(),
    states: {
      idle: {
        on: {
          "downloadCommand/copyRequested": {
            actions: "startCopyRequest",
            target: "copying",
          },
          "downloadCommand/methodSelected": {
            actions: "selectMethod",
          },
        },
      },
      copying: {
        on: {
          "downloadCommand/copyFailed": {
            actions: ["clearCopiedMethod", "clearPendingCopyRequest"],
            guard: "matchesPendingCopyRequest",
            target: "idle",
          },
          "downloadCommand/copySucceeded": {
            actions: ["storeCopiedMethod", "clearPendingCopyRequest"],
            guard: "matchesPendingCopyRequest",
            target: "copied",
          },
          "downloadCommand/methodSelected": {
            actions: "selectMethod",
          },
        },
      },
      copied: {
        after: {
          [copyFeedbackResetDelayMs]: {
            actions: "clearCopiedMethod",
            target: "idle",
          },
        },
        on: {
          "downloadCommand/copyRequested": {
            actions: "startCopyRequest",
            target: "copying",
          },
          "downloadCommand/methodSelected": {
            actions: "selectMethod",
          },
        },
      },
    },
  });
}

export function readCopiedMethodLabel(
  snapshot: SnapshotFrom<ReturnType<typeof createDownloadCommandMachine>>
): InstallMethodLabel | null {
  return snapshot.context.copiedMethodLabel;
}

export function readSelectedInstallMethod(
  snapshot: SnapshotFrom<ReturnType<typeof createDownloadCommandMachine>>
): InstallMethod {
  return getInstallMethod(snapshot.context.selectedMethodLabel);
}
