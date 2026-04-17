import { useEffect, useReducer } from "react";

import {
  trackInstallCommandCopied,
  trackInstallMethodSelected,
} from "../../analytics";
import {
  LANDING_COPY_FEEDBACK_RESET_DELAY_MS,
  LANDING_INSTALL_COMMANDS,
} from "../../landing-config";

type InstallMethodLabel = (typeof LANDING_INSTALL_COMMANDS)[number]["label"];

type DownloadCommandAction =
  | { type: "copyFailed" }
  | { type: "copySucceeded"; label: InstallMethodLabel }
  | { type: "resetCopyFeedback" }
  | { type: "selectMethod"; label: InstallMethodLabel };

type DownloadCommandState = {
  copiedMethodLabel: InstallMethodLabel | null;
  selectedMethodLabel: InstallMethodLabel;
};

const defaultInstallMethod = LANDING_INSTALL_COMMANDS[0];

const initialDownloadCommandState: DownloadCommandState = {
  copiedMethodLabel: null,
  selectedMethodLabel: defaultInstallMethod.label,
};

function downloadCommandReducer(
  state: DownloadCommandState,
  action: DownloadCommandAction
): DownloadCommandState {
  switch (action.type) {
    case "copyFailed":
      return {
        ...state,
        copiedMethodLabel: null,
      };

    case "copySucceeded":
      return {
        ...state,
        copiedMethodLabel: action.label,
      };

    case "resetCopyFeedback":
      if (state.copiedMethodLabel === null) {
        return state;
      }

      return {
        ...state,
        copiedMethodLabel: null,
      };

    case "selectMethod":
      return {
        ...state,
        selectedMethodLabel: action.label,
      };

    default:
      return state;
  }
}

function getInstallMethod(label: InstallMethodLabel) {
  return (
    LANDING_INSTALL_COMMANDS.find((method) => method.label === label) ??
    defaultInstallMethod
  );
}

export function DownloadCommand() {
  const [state, dispatch] = useReducer(
    downloadCommandReducer,
    initialDownloadCommandState
  );

  const selectedMethod = getInstallMethod(state.selectedMethodLabel);

  useEffect(() => {
    if (state.copiedMethodLabel === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      dispatch({ type: "resetCopyFeedback" });
    }, LANDING_COPY_FEEDBACK_RESET_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [state.copiedMethodLabel]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(selectedMethod.command);
      trackInstallCommandCopied(selectedMethod.label);
      dispatch({ type: "copySucceeded", label: selectedMethod.label });
    } catch {
      dispatch({ type: "copyFailed" });
    }
  }

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
              onClick={() => {
                trackInstallMethodSelected(method.label);
                dispatch({ type: "selectMethod", label: method.label });
              }}
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
          onClick={handleCopy}
        >
          {state.copiedMethodLabel === selectedMethod.label ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
