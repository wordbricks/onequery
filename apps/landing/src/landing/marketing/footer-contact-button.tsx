import { withState } from "@astrojs/react/actions";
import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { actions, isInputError } from "astro:actions";
import type { SafeResult } from "astro:actions";
import {
  ViewTransition,
  startTransition,
  useActionState,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFormStatus } from "react-dom";

import { INITIAL_CONTACT_ACTION_STATE } from "../../actions/contact-action-state";
import type { ContactActionState } from "../../actions/contact-action-state";
import {
  trackContactFormSubmitted,
  trackContactModalOpened,
} from "../analytics/landing-analytics";
import { readRootCssTimeMs } from "../transitions/use-text-swap-controller";
import { useTransitionedStoreState } from "../transitions/use-transitioned-store-state";
import {
  createContactModalStore,
  isContactModalClosing,
  isContactModalOpen,
} from "./contact-modal.store";

const DEFAULT_CONTACT_ERROR_MESSAGE = "Failed to send message";

type ContactActionResult = SafeResult<
  Record<string, unknown>,
  ContactActionState
>;

type ContactActionWithState = {
  (
    state: ContactActionResult,
    formData: FormData
  ): Promise<ContactActionResult>;
  $$FORM_ACTION: unknown;
  $$IS_SIGNATURE_EQUAL: (incomingActionName: string) => boolean;
};

const INITIAL_CONTACT_ACTION_RESULT: ContactActionResult = {
  data: INITIAL_CONTACT_ACTION_STATE,
  error: undefined,
};

type ContactModalController = {
  isClosing: boolean;
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

function readContactShakeMs() {
  return (
    readRootCssTimeMs("--shake-dur-a", 80) * 2 +
    readRootCssTimeMs("--shake-dur-b", 60) * 2
  );
}

function readContactModalCloseMs() {
  if (typeof document === "undefined") {
    return 150;
  }

  const closeMs = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--modal-close-dur"
    )
  );

  return Number.isFinite(closeMs) ? closeMs : 150;
}

function useContactErrorShakeController() {
  const formRef = useRef<HTMLFormElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const shakeTimerRef = useRef<number | null>(null);
  const revertTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (shakeTimerRef.current !== null) {
      window.clearTimeout(shakeTimerRef.current);
      shakeTimerRef.current = null;
    }

    if (revertTimerRef.current !== null) {
      window.clearTimeout(revertTimerRef.current);
      revertTimerRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => {
    const form = formRef.current;
    clearTimers();

    if (!form) {
      return;
    }

    form.classList.remove("is-error");
    form.querySelectorAll<HTMLElement>(".t-input").forEach((input) => {
      input.classList.remove("is-error", "is-shaking");
    });
  }, [clearTimers]);

  const showError = useCallback(() => {
    const form = formRef.current;
    clearTimers();

    if (!form) {
      return;
    }

    const inputs = Array.from(form.querySelectorAll<HTMLElement>(".t-input"));
    form.classList.add("is-error");
    inputs.forEach((input) => {
      input.classList.add("is-error");
      input.classList.remove("is-shaking");
    });

    void form.offsetWidth;
    inputs.forEach((input) => {
      input.classList.add("is-shaking");
    });

    const shakeMs = readContactShakeMs();
    shakeTimerRef.current = window.setTimeout(() => {
      inputs.forEach((input) => {
        input.classList.remove("is-shaking");
      });
      shakeTimerRef.current = null;
    }, shakeMs + 20);

    revertTimerRef.current = window.setTimeout(
      () => {
        clearError();
      },
      shakeMs + readRootCssTimeMs("--revert-hold", 3000)
    );
  }, [clearError, clearTimers]);

  const scheduleError = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      showError();
    });
  }, [showError]);

  useMountEffect(() => clearError);

  return {
    clearError,
    formRef,
    scheduleError,
  };
}

function useContactActionWithErrorShake(scheduleError: () => void) {
  const contactActionWithState = useMemo(
    () => withState(actions.contact) as ContactActionWithState,
    []
  );

  return useMemo(() => {
    const enhancedContactAction = (async (
      state: ContactActionResult,
      formData: FormData
    ) => {
      const result = await contactActionWithState(state, formData);

      if (result.error) {
        scheduleError();
      }

      return result;
    }) as ContactActionWithState;

    enhancedContactAction.$$FORM_ACTION = contactActionWithState.$$FORM_ACTION;
    enhancedContactAction.$$IS_SIGNATURE_EQUAL =
      contactActionWithState.$$IS_SIGNATURE_EQUAL;

    return enhancedContactAction;
  }, [contactActionWithState, scheduleError]);
}

function useContactModalController(): ContactModalController {
  const contactModalStore = useMemo(createContactModalControllerStore, []);
  const state = useTransitionedStoreState(contactModalStore.$contactModalState);
  const closeTimerRef = useRef<number | null>(null);

  function clearCloseTimer() {
    if (closeTimerRef.current === null) {
      return;
    }

    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  useMountEffect(() => clearCloseTimer);

  return {
    isClosing: isContactModalClosing(state),
    isOpen: isContactModalOpen(state),
    close: () => {
      clearCloseTimer();
      startTransition(() => {
        contactModalStore.close();
      });
      closeTimerRef.current = window.setTimeout(() => {
        startTransition(() => {
          contactModalStore.finishClose();
        });
        closeTimerRef.current = null;
      }, readContactModalCloseMs());
    },
    open: () => {
      clearCloseTimer();
      startTransition(() => {
        contactModalStore.open();
      });
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
      {controller.isOpen ? (
        <ViewTransition enter="scale-in" exit="scale-out" default="none">
          <ContactModal controller={controller} />
        </ViewTransition>
      ) : null}
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
  const [isVisible, setIsVisible] = useState(false);
  const errorShake = useContactErrorShakeController();
  const contactActionWithErrorShake = useContactActionWithErrorShake(
    errorShake.scheduleError
  );
  const [actionResult, contactAction] = useActionState(
    contactActionWithErrorShake,
    INITIAL_CONTACT_ACTION_RESULT
  );
  const errorMessage = readActionErrorMessage(
    actionResult.error,
    DEFAULT_CONTACT_ERROR_MESSAGE
  );
  const contactModalStateClass = controller.isClosing
    ? "is-closing"
    : isVisible
      ? "is-open"
      : "";

  useMountEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  });

  return (
    <div
      className={`contact-modal-backdrop ${contactModalStateClass}`.trim()}
      role="presentation"
      onMouseDown={controller.close}
    >
      <ContactModalLifecycle onClose={controller.close} />
      <div
        className={`contact-modal t-modal ${contactModalStateClass}`.trim()}
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
        <form
          ref={errorShake.formRef}
          className="contact-modal-form t-input-wrap"
          action={contactAction}
          onInput={errorShake.clearError}
          onInvalid={errorShake.scheduleError}
        >
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
            className="contact-modal-input t-input"
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
            className="contact-modal-input t-input"
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
          className="contact-modal-textarea t-input"
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
          <p className="marketing-form-feedback marketing-form-feedback-error t-error-msg">
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
