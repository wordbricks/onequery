import { atom } from "nanostores";

type ContactModalStatus = "closed" | "closing" | "open";

export type ContactModalState = {
  status: ContactModalStatus;
};

type ContactModalStoreOptions = {
  trackOpenRequested?: () => void;
};

function createInitialState(): ContactModalState {
  return {
    status: "closed",
  };
}

export function createContactModalStore(
  options: ContactModalStoreOptions = {}
) {
  const $contactModalState = atom<ContactModalState>(createInitialState());

  function close() {
    const state = $contactModalState.get();

    if (state.status !== "open") {
      return;
    }

    $contactModalState.set({
      status: "closing",
    });
  }

  function finishClose() {
    $contactModalState.set(createInitialState());
  }

  function open() {
    const state = $contactModalState.get();

    if (state.status === "open") {
      return;
    }

    $contactModalState.set({
      status: "open",
    });
    options.trackOpenRequested?.();
  }

  return {
    $contactModalState,
    close,
    finishClose,
    open,
  };
}

export function isContactModalOpen(state: ContactModalState) {
  return state.status !== "closed";
}

export function isContactModalClosing(state: ContactModalState) {
  return state.status === "closing";
}
