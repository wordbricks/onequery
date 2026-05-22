import { ViewTransition, startTransition, useMemo } from "react";

import {
  trackInstallCommandCopied,
  trackInstallMethodSelected,
} from "../analytics/landing-analytics";
import { INSTALL_COMMANDS } from "../config/landing-config";
import { useTextSwapController } from "../transitions/use-text-swap-controller";
import { useTransitionedStoreState } from "../transitions/use-transitioned-store-state";
import {
  createDownloadCommandStore,
  readSelectedInstallMethod,
} from "./download-command.store";
import type {
  DownloadCommandState,
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

function readCopyButtonLabel(state: DownloadCommandState) {
  return state.copiedMethodLabel === state.selectedMethodLabel
    ? "Copied"
    : "Copy";
}

function useDownloadCommandController(
  onCopyButtonLabelChange: (label: string) => void
) {
  const downloadCommandStore = useMemo(createDownloadCommandController, []);
  const state = useTransitionedStoreState(
    downloadCommandStore.$downloadCommandState,
    (nextState) => {
      onCopyButtonLabelChange(readCopyButtonLabel(nextState));
    }
  );
  const selectedMethod = readSelectedInstallMethod(state);

  return {
    copyButtonLabel: readCopyButtonLabel(state),
    selectedMethod,
    copy: () => {
      void downloadCommandStore.copy();
    },
    selectMethod: (label: (typeof INSTALL_COMMANDS)[number]["label"]) => {
      startTransition(() => {
        downloadCommandStore.selectMethod(label);
      });
    },
  };
}

export function DownloadCommand() {
  const copyButtonText = useTextSwapController("Copy");
  const { copy, copyButtonLabel, selectMethod, selectedMethod } =
    useDownloadCommandController(copyButtonText.swapText);

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
        <ViewTransition
          key={`install-label-${selectedMethod.label}`}
          enter="fade-in"
          exit="fade-out"
          default="none"
        >
          <span className="download-command-label">{selectedMethod.label}</span>
        </ViewTransition>
        <ViewTransition
          key={`install-command-${selectedMethod.label}`}
          enter="fade-in"
          exit="fade-out"
          default="none"
        >
          <code>{selectedMethod.command}</code>
        </ViewTransition>
        <button
          type="button"
          className="install-method-copy"
          aria-label={
            copyButtonLabel === "Copied"
              ? `${selectedMethod.label} install command copied`
              : `Copy ${selectedMethod.label} install command`
          }
          onClick={copy}
        >
          <span
            ref={copyButtonText.textRef}
            className="t-text-swap"
            aria-live="polite"
          >
            {copyButtonText.currentTextRef.current}
          </span>
        </button>
      </div>
    </div>
  );
}
