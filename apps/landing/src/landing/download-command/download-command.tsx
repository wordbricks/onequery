import { useActorRef, useSelector } from "@xstate/react";
import { fromPromise } from "xstate";

import {
  trackInstallCommandCopied,
  trackInstallMethodSelected,
} from "../analytics/landing-analytics";
import { INSTALL_COMMANDS } from "../config/landing-config";
import {
  createDownloadCommandMachine,
  readCopiedMethodLabel,
  readSelectedInstallMethod,
} from "./download-command.machine";
import type {
  DownloadCommandCopyInput,
  DownloadCommandCopyOutput,
} from "./download-command.machine";

function runBestEffort(action: () => void) {
  try {
    action();
  } catch {
    // Comment: landing analytics is best-effort and must not block clipboard
    // feedback or method selection in the install workflow.
  }
}

const downloadCommandMachine = createDownloadCommandMachine().provide({
  actions: {
    trackCopySucceeded: (_, params: DownloadCommandCopyOutput) => {
      runBestEffort(() => trackInstallCommandCopied(params.label));
    },
    trackMethodSelected: (
      _,
      params: { label: (typeof INSTALL_COMMANDS)[number]["label"] }
    ) => {
      runBestEffort(() => trackInstallMethodSelected(params.label));
    },
  },
  actors: {
    copyCommand: fromPromise<
      DownloadCommandCopyOutput,
      DownloadCommandCopyInput
    >(async ({ input }) => {
      await navigator.clipboard.writeText(input.command);

      return {
        label: input.label,
      };
    }),
  },
});

function useDownloadCommandController() {
  const actorRef = useActorRef(downloadCommandMachine);
  const selectedMethod = useSelector(actorRef, readSelectedInstallMethod);
  const copiedMethodLabel = useSelector(actorRef, readCopiedMethodLabel);

  return {
    copiedMethodLabel,
    selectedMethod,
    copy: () => {
      actorRef.send({ type: "downloadCommand/copyRequested" });
    },
    selectMethod: (label: (typeof INSTALL_COMMANDS)[number]["label"]) => {
      actorRef.send({
        type: "downloadCommand/methodSelected",
        label,
      });
    },
  };
}

export function DownloadCommand() {
  const { copiedMethodLabel, copy, selectMethod, selectedMethod } =
    useDownloadCommandController();

  return (
    <div className="install-selector">
      <div className="install-tabs" role="tablist" aria-label="Install method">
        {INSTALL_COMMANDS.map((method) => {
          const isSelected = method.label === selectedMethod.label;

          return (
            <button
              key={method.label}
              id={`install-tab-${method.label}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls="install-command-panel"
              className={`install-tab ${isSelected ? "install-tab-active" : ""}`}
              onClick={() => selectMethod(method.label)}
            >
              {method.label}
            </button>
          );
        })}
      </div>

      <div
        id="install-command-panel"
        className="download-command"
        role="tabpanel"
        aria-labelledby={`install-tab-${selectedMethod.label}`}
      >
        <span className="download-command-label">{selectedMethod.label}</span>
        <code>{selectedMethod.command}</code>
        <button
          type="button"
          className="install-method-copy"
          aria-label={`Copy ${selectedMethod.label} install command`}
          onClick={copy}
        >
          {copiedMethodLabel === selectedMethod.label ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
