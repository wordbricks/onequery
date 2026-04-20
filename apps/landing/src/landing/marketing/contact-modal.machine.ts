import { Result } from "better-result";
import {
  assertEvent,
  assign,
  fromCallback,
  fromPromise,
  sendTo,
  setup,
} from "xstate";
import type { SnapshotFrom } from "xstate";

import { toUserMessage } from "./marketing-errors";

const DEFAULT_CONTACT_ERROR_MESSAGE = "Failed to send message";

export type ContactForm = {
  email: string;
  message: string;
  name: string;
};

type ContactModalContext = {
  errorMessage: string | null;
  form: ContactForm;
  successfulSubmissionCount: number;
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

type ContactModalDependencies = {
  submitContact: (form: ContactForm) => Promise<void>;
  trackContactFormSubmitted?: () => void;
  trackContactModalOpened?: () => void;
};

type ContactModalTelemetryEvent =
  | {
      type: "contactModalTelemetry/modalOpened";
    }
  | {
      type: "contactModalTelemetry/formSubmitted";
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
    errorMessage: null,
    form: createEmptyContactForm(),
    successfulSubmissionCount: 0,
  };
}

const bindModalLifecycle = fromCallback<ContactModalEvent>(({ sendBack }) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") {
      return;
    }

    sendBack({ type: "contactModal/closeRequested" });
  }

  // Comment: keep modal-only DOM effects in a callback actor so the machine
  // stays deterministic while React only renders the current snapshot.
  window.addEventListener("keydown", handleKeyDown);

  return () => {
    document.body.style.overflow = previousOverflow;
    window.removeEventListener("keydown", handleKeyDown);
  };
});

export function createContactModalMachine(
  dependencies: ContactModalDependencies
) {
  const telemetry = fromCallback<ContactModalTelemetryEvent>(({ receive }) => {
    receive((event) => {
      const trackingResult = Result.try(() => {
        switch (event.type) {
          case "contactModalTelemetry/modalOpened": {
            dependencies.trackContactModalOpened?.();
            break;
          }
          case "contactModalTelemetry/formSubmitted": {
            dependencies.trackContactFormSubmitted?.();
            break;
          }
        }
      });

      if (trackingResult.isErr()) {
        // Comment: lead-capture telemetry is best-effort; never let it change
        // whether the modal opens, closes, or reports submission success.
      }
    });
  });

  return setup({
    types: {
      context: {} as ContactModalContext,
      events: {} as ContactModalEvent,
    },
    actions: {
      closeWithSuccess: assign({
        errorMessage: () => null,
        form: () => createEmptyContactForm(),
        successfulSubmissionCount: ({ context }) =>
          context.successfulSubmissionCount + 1,
      }),
      resetForm: assign(({ context }) => ({
        errorMessage: null,
        form: createEmptyContactForm(),
        successfulSubmissionCount: context.successfulSubmissionCount,
      })),
      storeFieldValue: assign(({ context, event }) => {
        assertEvent(event, "contactModal/fieldChanged");
        return {
          errorMessage: null,
          form: {
            ...context.form,
            [event.field]: event.value,
          },
        };
      }),
      storeSubmitError: assign({
        errorMessage: (_, params: { message: string }) => params.message,
      }),
    },
    actors: {
      bindModalLifecycle,
      submitContact: fromPromise<void, { form: ContactForm }>(
        async ({ input }) => dependencies.submitContact(input.form)
      ),
      telemetry,
    },
  }).createMachine({
    id: "contactModal",
    initial: "closed",
    invoke: {
      id: "telemetry",
      src: "telemetry",
    },
    context: createInitialContext(),
    states: {
      closed: {
        on: {
          "contactModal/openRequested": {
            actions: sendTo("telemetry", {
              type: "contactModalTelemetry/modalOpened",
            }),
            target: "open",
          },
        },
      },
      open: {
        invoke: {
          src: "bindModalLifecycle",
        },
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
              "contactModal/submit": "submitting",
            },
          },
          submitting: {
            invoke: {
              src: "submitContact",
              input: ({ context }) => ({
                form: context.form,
              }),
              onDone: {
                actions: [
                  "closeWithSuccess",
                  sendTo("telemetry", {
                    type: "contactModalTelemetry/formSubmitted",
                  }),
                ],
                target: "#contactModal.closed",
              },
              onError: {
                actions: {
                  type: "storeSubmitError",
                  params: ({ event }) => ({
                    message: toUserMessage(
                      event.error,
                      DEFAULT_CONTACT_ERROR_MESSAGE
                    ),
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
}

export function readContactModalErrorMessage(
  snapshot: SnapshotFrom<ReturnType<typeof createContactModalMachine>>
): string | null {
  return snapshot.context.errorMessage;
}
