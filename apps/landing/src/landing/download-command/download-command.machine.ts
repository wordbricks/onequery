import { Result } from "better-result";
import {
  assertEvent,
  assign,
  fromCallback,
  fromPromise,
  sendTo,
  setup,
} from "xstate";
import type { SnapshotFrom } from "xstate";

import {
  LANDING_COPY_FEEDBACK_RESET_DELAY_MS,
  LANDING_INSTALL_COMMANDS,
} from "../config/landing-config";

export type InstallMethod = (typeof LANDING_INSTALL_COMMANDS)[number];
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

type DownloadCommandDependencies = {
  copyCommand: (input: {
    command: string;
    label: InstallMethodLabel;
  }) => Promise<InstallMethodLabel>;
  copyFeedbackResetDelayMs?: number;
  trackInstallCommandCopied?: (label: InstallMethodLabel) => void;
  trackInstallMethodSelected?: (label: InstallMethodLabel) => void;
};

type DownloadCommandTelemetryEvent =
  | {
      type: "downloadCommandTelemetry/installCommandCopied";
      label: InstallMethodLabel;
    }
  | {
      type: "downloadCommandTelemetry/installMethodSelected";
      label: InstallMethodLabel;
    };

const defaultInstallMethod = LANDING_INSTALL_COMMANDS[0];

function createInitialContext(): DownloadCommandContext {
  return {
    copiedMethodLabel: null,
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
  dependencies: DownloadCommandDependencies
) {
  const copyFeedbackResetDelayMs =
    dependencies.copyFeedbackResetDelayMs ??
    LANDING_COPY_FEEDBACK_RESET_DELAY_MS;

  const telemetry = fromCallback<DownloadCommandTelemetryEvent>(
    ({ receive }) => {
      receive((event) => {
        const trackingResult = Result.try(() => {
          switch (event.type) {
            case "downloadCommandTelemetry/installCommandCopied": {
              dependencies.trackInstallCommandCopied?.(event.label);
              break;
            }
            case "downloadCommandTelemetry/installMethodSelected": {
              dependencies.trackInstallMethodSelected?.(event.label);
              break;
            }
          }
        });

        if (trackingResult.isErr()) {
          // Comment: analytics is best-effort only; drop tracker failures so
          // install command state stays driven by user intent and clipboard IO.
        }
      });
    }
  );

  return setup({
    types: {
      context: {} as DownloadCommandContext,
      events: {} as DownloadCommandEvent,
    },
    actions: {
      clearCopiedMethod: assign({
        copiedMethodLabel: () => null,
      }),
      selectMethod: assign(({ event }) => {
        assertEvent(event, "downloadCommand/methodSelected");
        return {
          selectedMethodLabel: event.label,
        };
      }),
      storeCopiedMethod: assign({
        copiedMethodLabel: (_, params: { label: InstallMethodLabel }) =>
          params.label,
      }),
    },
    actors: {
      copyCommand: fromPromise<
        InstallMethodLabel,
        {
          command: string;
          label: InstallMethodLabel;
        }
      >(async ({ input }) => dependencies.copyCommand(input)),
      telemetry,
    },
  }).createMachine({
    id: "downloadCommand",
    initial: "idle",
    invoke: {
      id: "telemetry",
      src: "telemetry",
    },
    context: createInitialContext(),
    states: {
      idle: {
        on: {
          "downloadCommand/copyRequested": "copying",
          "downloadCommand/methodSelected": {
            actions: [
              sendTo("telemetry", ({ event }) => ({
                type: "downloadCommandTelemetry/installMethodSelected",
                label: event.label,
              })),
              "selectMethod",
            ],
          },
        },
      },
      copying: {
        invoke: {
          src: "copyCommand",
          input: ({ context }) => {
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
                params: ({ event }) => ({
                  label: event.output,
                }),
              },
              sendTo("telemetry", ({ event }) => ({
                type: "downloadCommandTelemetry/installCommandCopied",
                label: event.output,
              })),
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
              sendTo("telemetry", ({ event }) => ({
                type: "downloadCommandTelemetry/installMethodSelected",
                label: event.label,
              })),
              "selectMethod",
            ],
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
          "downloadCommand/copyRequested": "copying",
          "downloadCommand/methodSelected": {
            actions: [
              sendTo("telemetry", ({ event }) => ({
                type: "downloadCommandTelemetry/installMethodSelected",
                label: event.label,
              })),
              "selectMethod",
            ],
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
