import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { useActorRef, useSelector } from "@xstate/react";

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

const downloadCommandMachine = createDownloadCommandMachine();

function runBestEffort(action: () => void) {
  try {
    action();
  } catch {
    // Comment: landing analytics is best-effort and must not block clipboard
    // feedback or method selection in the install workflow.
  }
}

function useDownloadCommandController() {
  const actorRef = useActorRef(downloadCommandMachine);
  const selectedMethod = useSelector(actorRef, readSelectedInstallMethod);
  const copiedMethodLabel = useSelector(actorRef, readCopiedMethodLabel);

  useMountEffect(() => {
    let isActive = true;
    let lastStartedCopyRequestId = 0;

    async function handleSnapshot(
      snapshot: ReturnType<typeof actorRef.getSnapshot>
    ) {
      const pendingCopyRequest = snapshot.context.pendingCopyRequest;

      if (
        !snapshot.matches("copying") ||
        pendingCopyRequest === null ||
        pendingCopyRequest.requestId === lastStartedCopyRequestId
      ) {
        return;
      }

      lastStartedCopyRequestId = pendingCopyRequest.requestId;

      try {
        await navigator.clipboard.writeText(pendingCopyRequest.command);

        if (!isActive) {
          return;
        }

        actorRef.send({
          type: "downloadCommand/copySucceeded",
          label: pendingCopyRequest.label,
          requestId: pendingCopyRequest.requestId,
        });
        runBestEffort(() =>
          trackInstallCommandCopied(pendingCopyRequest.label)
        );
      } catch {
        if (!isActive) {
          return;
        }

        actorRef.send({
          type: "downloadCommand/copyFailed",
          requestId: pendingCopyRequest.requestId,
        });
      }
    }

    void handleSnapshot(actorRef.getSnapshot());

    const subscription = actorRef.subscribe((snapshot) => {
      void handleSnapshot(snapshot);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  });

  return {
    copiedMethodLabel,
    selectedMethod,
    copy: () => {
      actorRef.send({ type: "downloadCommand/copyRequested" });
    },
    selectMethod: (
      label: (typeof LANDING_INSTALL_COMMANDS)[number]["label"]
    ) => {
      runBestEffort(() => trackInstallMethodSelected(label));
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
