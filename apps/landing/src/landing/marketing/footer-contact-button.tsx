import { withState } from "@astrojs/react/actions";
import { useStore } from "@nanostores/react";
import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { actions, isInputError } from "astro:actions";
import type { SafeResult } from "astro:actions";
import { useActionState, useMemo } from "react";
import { useFormStatus } from "react-dom";

import { INITIAL_CONTACT_ACTION_STATE } from "../../actions/contact-action-state";
import type { ContactActionState } from "../../actions/contact-action-state";
import {
  trackContactFormSubmitted,
  trackContactModalOpened,
} from "../analytics/landing-analytics";
import {
  createContactModalStore,
  isContactModalOpen,
} from "./contact-modal.store";

const DEFAULT_CONTACT_ERROR_MESSAGE = "Failed to send message";

type ContactActionResult = SafeResult<
  Record<string, unknown>,
  ContactActionState
>;

const INITIAL_CONTACT_ACTION_RESULT: ContactActionResult = {
  data: INITIAL_CONTACT_ACTION_STATE,
  error: undefined,
};

type ContactModalController = {
  isOpen: boolean;
  close: () => void;
  open: () => void;
};

type FooterContactButtonProps = {
  autoOpen?: boolean;
};

function readActionErrorMessage(
  error: unknown,
  fallback: string
): string | null {
  if (!error) {
    return null;
  }

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
    // Comment: landing analytics is best-effort and should never block modal
    // state transitions or Astro action result handling.
  }
}

function createContactModalControllerStore() {
  return createContactModalStore({
    trackOpenRequested: () => {
      runBestEffort(trackContactModalOpened);
    },
  });
}

function useContactModalController(): ContactModalController {
  const contactModalStore = useMemo(createContactModalControllerStore, []);
  const state = useStore(contactModalStore.$contactModalState);

  return {
    isOpen: isContactModalOpen(state),
    close: () => {
      contactModalStore.close();
    },
    open: () => {
      contactModalStore.open();
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
  const [actionResult, contactAction] = useActionState(
    withState(actions.contact),
    INITIAL_CONTACT_ACTION_RESULT
  );
  const errorMessage = readActionErrorMessage(
    actionResult.error,
    DEFAULT_CONTACT_ERROR_MESSAGE
  );

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

        {actionResult.data?.status === "sent" ? (
          <ContactSubmitSuccessLifecycle onSuccess={controller.close} />
        ) : null}
        <form className="contact-modal-form" action={contactAction}>
          <ContactModalFormFields errorMessage={errorMessage} />
        </form>
      </div>
    </div>
  );
}

function ContactModalFormFields({
  errorMessage,
}: {
  errorMessage: string | null;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <div className="contact-modal-field-grid">
        <label className="contact-modal-field">
          <span className="contact-modal-label">Name</span>
          <input
            type="text"
            name="name"
            placeholder="Jane Doe"
            className="contact-modal-input"
            disabled={pending}
            maxLength={200}
            required
          />
        </label>

        <label className="contact-modal-field">
          <span className="contact-modal-label">Email</span>
          <input
            type="email"
            name="email"
            placeholder="you@company.com"
            className="contact-modal-input"
            disabled={pending}
            maxLength={320}
            required
          />
        </label>
      </div>

      <label className="contact-modal-field">
        <span className="contact-modal-label">Message</span>
        <textarea
          name="message"
          placeholder="Share your agent workflow, production systems, or timeline."
          className="contact-modal-textarea"
          disabled={pending}
          maxLength={4000}
          required
        />
      </label>

      <div className="contact-modal-actions">
        <p className="contact-modal-note">
          We use this only to follow up on your request.
        </p>
        <button
          type="submit"
          className="button button-primary contact-modal-submit"
          disabled={pending}
        >
          {pending ? "Sending..." : "Send message"}
        </button>
        {errorMessage ? (
          <p className="marketing-form-feedback marketing-form-feedback-error">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </>
  );
}

function ContactSubmitSuccessLifecycle({
  onSuccess,
}: {
  onSuccess: () => void;
}) {
  useMountEffect(() => {
    runBestEffort(trackContactFormSubmitted);
    onSuccess();
  });

  return null;
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
