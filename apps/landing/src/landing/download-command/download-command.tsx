import { useStore } from "@nanostores/react";
import { useMemo } from "react";

import {
  trackInstallCommandCopied,
  trackInstallMethodSelected,
} from "../analytics/landing-analytics";
import { INSTALL_COMMANDS } from "../config/landing-config";
import {
  createDownloadCommandStore,
  readSelectedInstallMethod,
} from "./download-command.store";
import type {
  DownloadCommandCopyInput,
  DownloadCommandCopyOutput,
} from "./download-command.store";

function runBestEffort(action: () => void) {
  try {
    action();
  } catch {
    // Comment: landing analytics is best-effort and must not block clipboard
    // feedback or method selection in the install workflow.
  }
}

function createDownloadCommandController() {
  return createDownloadCommandStore({
    copyCommand: async (input: DownloadCommandCopyInput) => {
      await navigator.clipboard.writeText(input.command);

      return {
        label: input.label,
      };
    },
    trackCopySucceeded: (params: DownloadCommandCopyOutput) => {
      runBestEffort(() => trackInstallCommandCopied(params.label));
    },
    trackMethodSelected: (params) => {
      runBestEffort(() => trackInstallMethodSelected(params.label));
    },
  });
}

function useDownloadCommandController() {
  const downloadCommandStore = useMemo(createDownloadCommandController, []);
  const state = useStore(downloadCommandStore.$downloadCommandState);
  const selectedMethod = readSelectedInstallMethod(state);

  return {
    copiedMethodLabel: state.copiedMethodLabel,
    selectedMethod,
    copy: () => {
      void downloadCommandStore.copy();
    },
    selectMethod: (label: (typeof INSTALL_COMMANDS)[number]["label"]) => {
      downloadCommandStore.selectMethod(label);
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
