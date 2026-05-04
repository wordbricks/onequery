import { assertEvent, assign, fromPromise, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

export const DEFAULT_CONTACT_ERROR_MESSAGE = "Failed to send message";

export type ContactForm = {
  email: string;
  message: string;
  name: string;
};

type ContactModalSubmission = { kind: "idle" } | ContactModalSubmissionFailure;

type ContactModalSubmissionFailure = {
  kind: "submitFailed";
  message: string;
};

export type ContactModalSubmissionInput = {
  form: ContactForm;
};

type ContactModalContext = {
  form: ContactForm;
  submission: ContactModalSubmission;
};

type ContactModalEvent =
  | {
      type: "contactModal/closeRequested";
    }
  | {
      type: "contactModal/fieldChanged";
      field: keyof ContactForm;
      value: string;
    }
  | {
      type: "contactModal/openRequested";
    }
  | {
      type: "contactModal/submit";
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

function createInitialContext(): ContactModalContext {
  return {
    form: createEmptyContactForm(),
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

const contactModalMachine = setup({
  types: {
    context: {} as ContactModalContext,
    events: {} as ContactModalEvent,
  },
  actions: {
    closeWithSuccess: assign({
      form: () => createEmptyContactForm(),
      submission: () => createIdleSubmission(),
    }),
    resetForm: assign(() => ({
      form: createEmptyContactForm(),
      submission: createIdleSubmission(),
    })),
    storeFieldValue: assign(({ context, event }) => {
      assertEvent(event, "contactModal/fieldChanged");
      return {
        form: {
          ...context.form,
          [event.field]: event.value,
        },
        submission: createIdleSubmission(),
      };
    }),
    storeSubmitError: assign({
      submission: (_, params: { error: unknown }) => ({
        kind: "submitFailed" as const,
        message: readContactSubmitError(params.error),
      }),
    }),
    trackOpenRequested: () => undefined,
    trackSubmitSucceeded: () => undefined,
  },
  actors: {
    submitContact: fromPromise<void, ContactModalSubmissionInput>(
      async () => undefined
    ),
  },
}).createMachine({
  id: "contactModal",
  initial: "closed",
  context: () => createInitialContext(),
  states: {
    closed: {
      on: {
        "contactModal/openRequested": {
          actions: "trackOpenRequested",
          target: "open",
        },
      },
    },
    open: {
      initial: "editing",
      on: {
        "contactModal/closeRequested": {
          actions: "resetForm",
          target: "closed",
        },
      },
      states: {
        editing: {
          on: {
            "contactModal/fieldChanged": {
              actions: "storeFieldValue",
            },
            "contactModal/submit": {
              target: "submitting",
            },
          },
        },
        submitting: {
          invoke: {
            src: "submitContact",
            input: ({ context, event }) => {
              assertEvent(event, "contactModal/submit");

              return {
                form: { ...context.form },
              };
            },
            onDone: {
              actions: ["trackSubmitSucceeded", "closeWithSuccess"],
              target: "#contactModal.closed",
            },
            onError: {
              actions: {
                type: "storeSubmitError",
                params: ({ event }) => ({
                  error: event.error,
                }),
              },
              target: "editing",
            },
          },
        },
      },
    },
  },
});

export function createContactModalMachine() {
  return contactModalMachine;
}

export function readContactModalErrorMessage(
  snapshot: SnapshotFrom<ReturnType<typeof createContactModalMachine>>
): string | null {
  if (snapshot.context.submission.kind !== "submitFailed") {
    return null;
  }

  return snapshot.context.submission.message;
}
