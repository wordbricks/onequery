import { atom } from "nanostores";

import {
  COPY_FEEDBACK_RESET_DELAY_MS,
  INSTALL_COMMANDS,
} from "../config/landing-config";

export type InstallMethod = (typeof INSTALL_COMMANDS)[number];
export type InstallMethodLabel = InstallMethod["label"];

export type DownloadCommandState = {
  copiedMethodLabel: InstallMethodLabel | null;
  isCopying: boolean;
  selectedMethodLabel: InstallMethodLabel;
};

export type DownloadCommandCopyInput = {
  command: string;
  label: InstallMethodLabel;
};

export type DownloadCommandCopyOutput = {
  label: InstallMethodLabel;
};

type DownloadCommandStoreOptions = {
  copyCommand?: (
    input: DownloadCommandCopyInput
  ) => Promise<DownloadCommandCopyOutput>;
  copyFeedbackResetDelayMs?: number;
  trackCopySucceeded?: (params: DownloadCommandCopyOutput) => void;
  trackMethodSelected?: (params: { label: InstallMethodLabel }) => void;
};

const defaultInstallMethod = INSTALL_COMMANDS[0];

function createInitialState(): DownloadCommandState {
  return {
    copiedMethodLabel: null,
    isCopying: false,
    selectedMethodLabel: defaultInstallMethod.label,
  };
}

async function copyCommandToClipboard({
  command,
  label,
}: DownloadCommandCopyInput): Promise<DownloadCommandCopyOutput> {
  await navigator.clipboard.writeText(command);

  return {
    label,
  };
}

export function getInstallMethod(label: InstallMethodLabel): InstallMethod {
  return (
    INSTALL_COMMANDS.find((method) => method.label === label) ??
    defaultInstallMethod
  );
}

export function readSelectedInstallMethod(
  state: DownloadCommandState
): InstallMethod {
  return getInstallMethod(state.selectedMethodLabel);
}

export function createDownloadCommandStore(
  options: DownloadCommandStoreOptions = {}
) {
  const $downloadCommandState =
    atom<DownloadCommandState>(createInitialState());
  const copyCommand = options.copyCommand ?? copyCommandToClipboard;
  const copyFeedbackResetDelayMs =
    options.copyFeedbackResetDelayMs ?? COPY_FEEDBACK_RESET_DELAY_MS;
  let copyFeedbackTimeout: ReturnType<typeof setTimeout> | undefined;

  function clearCopyFeedbackTimeout() {
    if (copyFeedbackTimeout !== undefined) {
      clearTimeout(copyFeedbackTimeout);
      copyFeedbackTimeout = undefined;
    }
  }

  function clearCopiedMethod() {
    clearCopyFeedbackTimeout();
    $downloadCommandState.set({
      ...$downloadCommandState.get(),
      copiedMethodLabel: null,
      isCopying: false,
    });
  }

  function scheduleCopyFeedbackReset() {
    clearCopyFeedbackTimeout();
    copyFeedbackTimeout = setTimeout(() => {
      clearCopiedMethod();
    }, copyFeedbackResetDelayMs);
  }

  function selectMethod(label: InstallMethodLabel) {
    $downloadCommandState.set({
      ...$downloadCommandState.get(),
      selectedMethodLabel: label,
    });
    options.trackMethodSelected?.({ label });
  }

  async function copy() {
    const state = $downloadCommandState.get();

    if (state.isCopying) {
      return;
    }

    const installMethod = getInstallMethod(state.selectedMethodLabel);
    clearCopyFeedbackTimeout();
    $downloadCommandState.set({
      ...state,
      isCopying: true,
    });

    try {
      const output = await copyCommand({
        command: installMethod.command,
        label: installMethod.label,
      });

      $downloadCommandState.set({
        ...$downloadCommandState.get(),
        copiedMethodLabel: output.label,
        isCopying: false,
      });
      options.trackCopySucceeded?.(output);
      scheduleCopyFeedbackReset();
    } catch {
      clearCopiedMethod();
    }
  }

  function reset() {
    clearCopyFeedbackTimeout();
    $downloadCommandState.set(createInitialState());
  }

  return {
    $downloadCommandState,
    copy,
    reset,
    selectMethod,
  };
}
