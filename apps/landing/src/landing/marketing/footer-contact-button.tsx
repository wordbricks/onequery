import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { useActorRef, useSelector } from "@xstate/react";
import { actions, isInputError } from "astro:actions";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import type { FormEvent } from "react";
import { fromPromise } from "xstate";

import {
  trackContactFormSubmitted,
  trackContactModalOpened,
} from "../analytics/landing-analytics";
import {
  DEFAULT_CONTACT_ERROR_MESSAGE,
  createContactModalMachine,
  readContactModalErrorMessage,
} from "./contact-modal.machine";
import type {
  ContactForm,
  ContactModalSubmissionInput,
} from "./contact-modal.machine";

class ContactSubmissionError extends TaggedError("ContactSubmissionError")<{
  cause: unknown;
  message: string;
}>() {}

type ContactSubmissionResult = ResultType<void, ContactSubmissionError>;

type ContactModalController = {
  errorMessage: string | null;
  form: ContactForm;
  isOpen: boolean;
  isSubmitting: boolean;
  close: () => void;
  open: () => void;
  setField: (field: keyof ContactForm, value: string) => void;
  submit: () => void;
};

type FooterContactButtonProps = {
  autoOpen?: boolean;
};

function readActionErrorMessage(error: unknown, fallback: string): string {
  if (isInputError(error)) {
    const fieldMessage = Object.values(error.fields)
      .flat()
      .find((message): message is string => typeof message === "string");

    if (fieldMessage) {
      return fieldMessage;
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }

  return fallback;
}

function runBestEffort(action: () => void) {
  try {
    action();
  } catch {
    // Comment: landing analytics is best-effort and should never block form
    // state transitions or RPC result handling.
  }
}

async function submitContactRequest(
  input: ContactModalSubmissionInput & { signal: AbortSignal }
): Promise<ContactSubmissionResult> {
  const responseResult = await Result.tryPromise({
    try: async () => {
      input.signal.throwIfAborted();

      const result = await actions.contact(input.form);
      if (result.error) {
        throw new ContactSubmissionError({
          cause: result.error,
          message: readActionErrorMessage(
            result.error,
            DEFAULT_CONTACT_ERROR_MESSAGE
          ),
        });
      }
    },
    catch: (cause: unknown) =>
      cause instanceof ContactSubmissionError
        ? cause
        : new ContactSubmissionError({
            cause,
            message: DEFAULT_CONTACT_ERROR_MESSAGE,
          }),
  });

  return responseResult;
}

const contactModalMachine = createContactModalMachine().provide({
  actions: {
    trackOpenRequested: () => {
      runBestEffort(trackContactModalOpened);
    },
    trackSubmitSucceeded: () => {
      runBestEffort(trackContactFormSubmitted);
    },
  },
  actors: {
    submitContact: fromPromise<void, ContactModalSubmissionInput>(
      async ({ input, signal }) => {
        const result = await submitContactRequest({
          ...input,
          signal,
        });

        if (result.isErr()) {
          throw result.error;
        }
      }
    ),
  },
});

function useContactModalController(): ContactModalController {
  const actorRef = useActorRef(contactModalMachine);
  const form = useSelector(actorRef, (snapshot) => snapshot.context.form);
  const errorMessage = useSelector(actorRef, readContactModalErrorMessage);
  const isOpen = useSelector(actorRef, (snapshot) => snapshot.matches("open"));
  const isSubmitting = useSelector(actorRef, (snapshot) =>
    snapshot.matches({ open: "submitting" })
  );

  return {
    errorMessage,
    form,
    isOpen,
    isSubmitting,
    close: () => {
      actorRef.send({ type: "contactModal/closeRequested" });
    },
    open: () => {
      actorRef.send({ type: "contactModal/openRequested" });
    },
    setField: (field, value) => {
      actorRef.send({
        type: "contactModal/fieldChanged",
        field,
        value,
      });
    },
    submit: () => {
      actorRef.send({ type: "contactModal/submit" });
    },
  };
}

export function FooterContactButton({
  autoOpen = false,
}: FooterContactButtonProps) {
  const controller = useContactModalController();

  return (
    <>
      {autoOpen ? <ContactModalAutoOpen open={controller.open} /> : null}
      <button
        type="button"
        className="contact-link-button"
        onClick={controller.open}
      >
        Contact
      </button>
      {controller.isOpen ? <ContactModal controller={controller} /> : null}
    </>
  );
}

function ContactModalAutoOpen({ open }: { open: () => void }) {
  useMountEffect(() => {
    open();
  });

  return null;
}

function ContactModal({ controller }: { controller: ContactModalController }) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    controller.submit();
  }

  return (
    <div
      className="contact-modal-backdrop"
      role="presentation"
      onMouseDown={controller.close}
    >
      <ContactModalLifecycle onClose={controller.close} />
      <div
        className="contact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="contact-modal-close"
          onClick={controller.close}
          aria-label="Close contact form"
        >
          x
        </button>

        <div className="contact-modal-header">
          <p className="eyebrow">Start a conversation</p>
          <h2 id="contact-modal-title">Contact OneQuery</h2>
          <p className="contact-modal-copy">
            Tell us how you want agents to debug production. We can help with
            self-hosting, capability grants, and rollout questions.
          </p>
        </div>

        <form className="contact-modal-form" onSubmit={handleSubmit}>
          <div className="contact-modal-field-grid">
            <label className="contact-modal-field">
              <span className="contact-modal-label">Name</span>
              <input
                type="text"
                placeholder="Jane Doe"
                className="contact-modal-input"
                disabled={controller.isSubmitting}
                value={controller.form.name}
                onChange={(event) =>
                  controller.setField("name", event.currentTarget.value)
                }
              />
            </label>

            <label className="contact-modal-field">
              <span className="contact-modal-label">Email</span>
              <input
                type="email"
                placeholder="you@company.com"
                className="contact-modal-input"
                disabled={controller.isSubmitting}
                value={controller.form.email}
                onChange={(event) =>
                  controller.setField("email", event.currentTarget.value)
                }
              />
            </label>
          </div>

          <label className="contact-modal-field">
            <span className="contact-modal-label">Message</span>
            <textarea
              placeholder="Share your agent workflow, production systems, or timeline."
              className="contact-modal-textarea"
              disabled={controller.isSubmitting}
              value={controller.form.message}
              onChange={(event) =>
                controller.setField("message", event.currentTarget.value)
              }
            />
          </label>

          <div className="contact-modal-actions">
            <p className="contact-modal-note">
              We use this only to follow up on your request.
            </p>
            <button
              type="submit"
              className="button button-primary contact-modal-submit"
              disabled={controller.isSubmitting}
            >
              {controller.isSubmitting ? "Sending..." : "Send message"}
            </button>
            {controller.errorMessage ? (
              <p className="marketing-form-feedback marketing-form-feedback-error">
                {controller.errorMessage}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

function ContactModalLifecycle({ onClose }: { onClose: () => void }) {
  useMountEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  });

  return null;
}
