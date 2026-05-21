import { atom } from "nanostores";

export const DEFAULT_CONTACT_ERROR_MESSAGE = "Failed to send message";

export type ContactForm = {
  email: string;
  message: string;
  name: string;
};

type ContactModalStatus = "closed" | "editing" | "submitting";

type ContactModalSubmission = { kind: "idle" } | ContactModalSubmissionFailure;

type ContactModalSubmissionFailure = {
  kind: "submitFailed";
  message: string;
};

export type ContactModalState = {
  form: ContactForm;
  status: ContactModalStatus;
  submission: ContactModalSubmission;
};

export type ContactModalSubmissionInput = {
  form: ContactForm;
};

export type ContactModalSubmitRequest = ContactModalSubmissionInput & {
  signal: AbortSignal;
};

type ContactModalStoreOptions = {
  submitContact?: (input: ContactModalSubmitRequest) => Promise<void>;
  trackOpenRequested?: () => void;
  trackSubmitSucceeded?: () => void;
};

function createEmptyContactForm(): ContactForm {
  return {
    email: "",
    message: "",
    name: "",
  };
}

function createIdleSubmission(): ContactModalSubmission {
  return {
    kind: "idle",
  };
}

function createInitialState(): ContactModalState {
  return {
    form: createEmptyContactForm(),
    status: "closed",
    submission: createIdleSubmission(),
  };
}

function readContactSubmitError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }

  return DEFAULT_CONTACT_ERROR_MESSAGE;
}

async function submitContactNoop(): Promise<void> {
  return undefined;
}

export function createContactModalStore(
  options: ContactModalStoreOptions = {}
) {
  const $contactModalState = atom<ContactModalState>(createInitialState());
  const submitContact = options.submitContact ?? submitContactNoop;
  let activeSubmitController: AbortController | null = null;

  function resetActiveSubmit() {
    if (activeSubmitController === null) {
      return;
    }

    activeSubmitController.abort();
    activeSubmitController = null;
  }

  function close() {
    resetActiveSubmit();
    $contactModalState.set(createInitialState());
  }

  function open() {
    const state = $contactModalState.get();

    if (state.status !== "closed") {
      return;
    }

    $contactModalState.set({
      ...state,
      status: "editing",
    });
    options.trackOpenRequested?.();
  }

  function setField(field: keyof ContactForm, value: string) {
    const state = $contactModalState.get();

    if (state.status === "closed") {
      return;
    }

    $contactModalState.set({
      ...state,
      form: {
        ...state.form,
        [field]: value,
      },
      submission: createIdleSubmission(),
    });
  }

  async function submit() {
    const state = $contactModalState.get();

    if (state.status !== "editing") {
      return;
    }

    const submitController = new AbortController();
    activeSubmitController = submitController;
    $contactModalState.set({
      ...state,
      status: "submitting",
      submission: createIdleSubmission(),
    });

    try {
      await submitContact({
        form: { ...state.form },
        signal: submitController.signal,
      });

      if (activeSubmitController !== submitController) {
        return;
      }

      activeSubmitController = null;
      options.trackSubmitSucceeded?.();
      $contactModalState.set(createInitialState());
    } catch (error) {
      if (
        submitController.signal.aborted ||
        activeSubmitController !== submitController
      ) {
        return;
      }

      activeSubmitController = null;
      $contactModalState.set({
        ...$contactModalState.get(),
        status: "editing",
        submission: {
          kind: "submitFailed",
          message: readContactSubmitError(error),
        },
      });
    }
  }

  return {
    $contactModalState,
    close,
    open,
    setField,
    submit,
  };
}

export function isContactModalOpen(state: ContactModalState) {
  return state.status !== "closed";
}

export function isContactModalSubmitting(state: ContactModalState) {
  return state.status === "submitting";
}

export function readContactModalErrorMessage(
  state: ContactModalState
): string | null {
  if (state.submission.kind !== "submitFailed") {
    return null;
  }

  return state.submission.message;
}
