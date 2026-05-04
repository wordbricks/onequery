import { assertEvent, assign, fromPromise, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

import {
  COPY_FEEDBACK_RESET_DELAY_MS,
  INSTALL_COMMANDS,
} from "../config/landing-config";

export type InstallMethod = (typeof INSTALL_COMMANDS)[number];
export type InstallMethodLabel = InstallMethod["label"];

type DownloadCommandContext = {
  copiedMethodLabel: InstallMethodLabel | null;
  selectedMethodLabel: InstallMethodLabel;
};

type DownloadCommandEvent =
  | {
      type: "downloadCommand/copyRequested";
    }
  | {
      type: "downloadCommand/methodSelected";
      label: InstallMethodLabel;
    };

export type DownloadCommandCopyInput = {
  command: string;
  label: InstallMethodLabel;
};

export type DownloadCommandCopyOutput = {
  label: InstallMethodLabel;
};

type DownloadCommandMachineOptions = {
  copyFeedbackResetDelayMs?: number;
};

const defaultInstallMethod = INSTALL_COMMANDS[0];

function createInitialContext(): DownloadCommandContext {
  return {
    copiedMethodLabel: null,
    selectedMethodLabel: defaultInstallMethod.label,
  };
}

export function getInstallMethod(label: InstallMethodLabel): InstallMethod {
  return (
    INSTALL_COMMANDS.find((method) => method.label === label) ??
    defaultInstallMethod
  );
}

const downloadCommandMachine = setup({
  types: {
    context: {} as DownloadCommandContext,
    events: {} as DownloadCommandEvent,
  },
  actions: {
    clearCopiedMethod: assign({
      copiedMethodLabel: () => null,
    }),
    selectMethod: assign({
      selectedMethodLabel: (_, params: { label: InstallMethodLabel }) =>
        params.label,
    }),
    storeCopiedMethod: assign({
      copiedMethodLabel: (_, params: DownloadCommandCopyOutput) => params.label,
    }),
    trackCopySucceeded: (_, params: { label: InstallMethodLabel }) => {
      void params;
    },
    trackMethodSelected: (_, params: { label: InstallMethodLabel }) => {
      void params;
    },
  },
  actors: {
    copyCommand: fromPromise<
      DownloadCommandCopyOutput,
      DownloadCommandCopyInput
    >(async ({ input }) => ({
      label: input.label,
    })),
  },
  delays: {
    copyFeedbackReset: COPY_FEEDBACK_RESET_DELAY_MS,
  },
}).createMachine({
  id: "downloadCommand",
  initial: "idle",
  context: () => createInitialContext(),
  states: {
    idle: {
      on: {
        "downloadCommand/copyRequested": {
          target: "copying",
        },
        "downloadCommand/methodSelected": {
          actions: [
            {
              type: "selectMethod",
              params: ({ event }) => ({
                label: event.label,
              }),
            },
            {
              type: "trackMethodSelected",
              params: ({ event }) => ({
                label: event.label,
              }),
            },
          ],
        },
      },
    },
    copying: {
      invoke: {
        src: "copyCommand",
        input: ({ context, event }) => {
          assertEvent(event, "downloadCommand/copyRequested");

          const installMethod = getInstallMethod(context.selectedMethodLabel);

          return {
            command: installMethod.command,
            label: installMethod.label,
          };
        },
        onDone: {
          actions: [
            {
              type: "storeCopiedMethod",
              params: ({ event }) => event.output,
            },
            {
              type: "trackCopySucceeded",
              params: ({ event }) => ({
                label: event.output.label,
              }),
            },
          ],
          target: "copied",
        },
        onError: {
          actions: "clearCopiedMethod",
          target: "idle",
        },
      },
      on: {
        "downloadCommand/methodSelected": {
          actions: [
            {
              type: "selectMethod",
              params: ({ event }) => ({
                label: event.label,
              }),
            },
            {
              type: "trackMethodSelected",
              params: ({ event }) => ({
                label: event.label,
              }),
            },
          ],
        },
      },
    },
    copied: {
      after: {
        copyFeedbackReset: {
          actions: "clearCopiedMethod",
          target: "idle",
        },
      },
      on: {
        "downloadCommand/copyRequested": {
          target: "copying",
        },
        "downloadCommand/methodSelected": {
          actions: [
            {
              type: "selectMethod",
              params: ({ event }) => ({
                label: event.label,
              }),
            },
            {
              type: "trackMethodSelected",
              params: ({ event }) => ({
                label: event.label,
              }),
            },
          ],
        },
      },
    },
  },
});

export function createDownloadCommandMachine(
  options: DownloadCommandMachineOptions = {}
) {
  const copyFeedbackResetDelayMs =
    options.copyFeedbackResetDelayMs ?? COPY_FEEDBACK_RESET_DELAY_MS;

  return downloadCommandMachine.provide({
    delays: {
      copyFeedbackReset: copyFeedbackResetDelayMs,
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
