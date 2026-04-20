import { LANDING_INSTALL_COMMANDS } from "../config/landing-config";

export type InstallMethod = (typeof LANDING_INSTALL_COMMANDS)[number];
export type InstallMethodLabel = InstallMethod["label"];

export type DownloadCommandAction =
  | { type: "copyFailed" }
  | { type: "copySucceeded"; label: InstallMethodLabel }
  | { type: "resetCopyFeedback" }
  | { type: "selectMethod"; label: InstallMethodLabel };

export type DownloadCommandState = {
  copiedMethodLabel: InstallMethodLabel | null;
  selectedMethodLabel: InstallMethodLabel;
};

const defaultInstallMethod = LANDING_INSTALL_COMMANDS[0];

export const initialDownloadCommandState: DownloadCommandState = {
  copiedMethodLabel: null,
  selectedMethodLabel: defaultInstallMethod.label,
};

export function downloadCommandReducer(
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

export function getInstallMethod(label: InstallMethodLabel): InstallMethod {
  return (
    LANDING_INSTALL_COMMANDS.find((method) => method.label === label) ??
    defaultInstallMethod
  );
}
