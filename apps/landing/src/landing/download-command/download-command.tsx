import { useActorRef, useSelector } from "@xstate/react";
import { useEffect } from "react";

import {
  trackInstallCommandCopied,
  trackInstallMethodSelected,
} from "../analytics/landing-analytics";
import { LANDING_INSTALL_COMMANDS } from "../config/landing-config";
import {
  createDownloadCommandMachine,
  readCopiedMethodLabel,
  readSelectedInstallMethod,
} from "./download-command.machine";

const downloadCommandMachine = createDownloadCommandMachine({
  async copyCommand({ command, label }) {
    await navigator.clipboard.writeText(command);
    return label;
  },
});

function useDownloadCommandController() {
  const actorRef = useActorRef(downloadCommandMachine);
  const selectedMethod = useSelector(actorRef, readSelectedInstallMethod);
  const copiedMethodLabel = useSelector(actorRef, readCopiedMethodLabel);

  useEffect(() => {
    if (copiedMethodLabel === null) {
      return;
    }

    trackInstallCommandCopied(copiedMethodLabel);
  }, [copiedMethodLabel]);

  return {
    copiedMethodLabel,
    selectedMethod,
    copy() {
      actorRef.send({ type: "downloadCommand/copyRequested" });
    },
    selectMethod(label: (typeof LANDING_INSTALL_COMMANDS)[number]["label"]) {
      trackInstallMethodSelected(label);
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
        {LANDING_INSTALL_COMMANDS.map((method) => {
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
