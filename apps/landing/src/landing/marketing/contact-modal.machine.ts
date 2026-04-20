import { assertEvent, assign, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

export const DEFAULT_CONTACT_ERROR_MESSAGE = "Failed to send message";

export type ContactForm = {
  email: string;
  message: string;
  name: string;
};

type ContactModalContext = {
  form: ContactForm;
  nextSubmissionRequestId: number;
  pendingSubmission: {
    form: ContactForm;
    requestId: number;
  } | null;
  submission:
    | {
        kind: "idle";
      }
    | {
        kind: "submitFailed";
        message: string;
      };
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
    }
  | {
      type: "contactModal/submitFailed";
      message: string;
      requestId: number;
    }
  | {
      type: "contactModal/submitSucceeded";
      requestId: number;
    };

function createEmptyContactForm(): ContactForm {
  return {
    email: "",
    message: "",
    name: "",
  };
}

function createInitialContext(): ContactModalContext {
  return {
    form: createEmptyContactForm(),
    nextSubmissionRequestId: 1,
    pendingSubmission: null,
    submission: {
      kind: "idle",
    },
  };
}

export function createContactModalMachine() {
  return setup({
    types: {
      context: {} as ContactModalContext,
      events: {} as ContactModalEvent,
    },
    actions: {
      closeWithSuccess: assign({
        form: () => createEmptyContactForm(),
        pendingSubmission: () => null,
        submission: () => ({
          kind: "idle" as const,
        }),
      }),
      clearPendingSubmission: assign({
        pendingSubmission: () => null,
      }),
      resetForm: assign(() => ({
        form: createEmptyContactForm(),
        pendingSubmission: null,
        submission: {
          kind: "idle" as const,
        },
      })),
      startSubmitRequest: assign(({ context }) => ({
        nextSubmissionRequestId: context.nextSubmissionRequestId + 1,
        pendingSubmission: {
          form: { ...context.form },
          requestId: context.nextSubmissionRequestId,
        },
      })),
      storeFieldValue: assign(({ context, event }) => {
        assertEvent(event, "contactModal/fieldChanged");
        return {
          form: {
            ...context.form,
            [event.field]: event.value,
          },
          submission: {
            kind: "idle" as const,
          },
        };
      }),
      storeSubmitError: assign({
        submission: ({ context, event }) => {
          assertEvent(event, "contactModal/submitFailed");

          if (context.pendingSubmission?.requestId !== event.requestId) {
            return context.submission;
          }

          return {
            kind: "submitFailed" as const,
            message: event.message,
          };
        },
      }),
    },
    guards: {
      matchesPendingSubmission: ({ context, event }) => {
        if (
          event.type !== "contactModal/submitFailed" &&
          event.type !== "contactModal/submitSucceeded"
        ) {
          return false;
        }

        return context.pendingSubmission?.requestId === event.requestId;
      },
    },
  }).createMachine({
    id: "contactModal",
    initial: "closed",
    context: createInitialContext(),
    states: {
      closed: {
        on: {
          "contactModal/openRequested": "open",
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
                actions: "startSubmitRequest",
                target: "submitting",
              },
            },
          },
          submitting: {
            on: {
              "contactModal/submitFailed": {
                actions: ["storeSubmitError", "clearPendingSubmission"],
                guard: "matchesPendingSubmission",
                target: "editing",
              },
              "contactModal/submitSucceeded": {
                actions: ["closeWithSuccess", "clearPendingSubmission"],
                guard: "matchesPendingSubmission",
                target: "#contactModal.closed",
              },
            },
          },
        },
      },
    },
  });
}

export function readContactModalErrorMessage(
  snapshot: SnapshotFrom<ReturnType<typeof createContactModalMachine>>
): string | null {
  if (snapshot.context.submission.kind !== "submitFailed") {
    return null;
  }

  return snapshot.context.submission.message;
}
