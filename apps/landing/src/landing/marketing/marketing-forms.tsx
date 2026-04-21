import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { useActorRef, useSelector } from "@xstate/react";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import { landingApiClient } from "../../app/runtime/landing-api-client";
import type { LandingApiErrorResponse } from "../../app/runtime/landing-api-client";
import {
  trackContactFormSubmitted,
  trackContactModalOpened,
  trackProductUpdatesSignup,
} from "../analytics/landing-analytics";
import type { ContactForm } from "./contact-modal.machine";
import {
  DEFAULT_CONTACT_ERROR_MESSAGE,
  createContactModalMachine,
  readContactModalErrorMessage,
} from "./contact-modal.machine";
import {
  DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE,
  createProductUpdatesMachine,
  readProductUpdatesFeedback,
} from "./product-updates.machine";

const productUpdatesMachine = createProductUpdatesMachine();
const contactModalMachine = createContactModalMachine();

class ProductUpdatesSubmissionError extends TaggedError(
  "ProductUpdatesSubmissionError"
)<{
  cause: unknown;
  message: string;
}>() {}

class ContactSubmissionError extends TaggedError("ContactSubmissionError")<{
  cause: unknown;
  message: string;
}>() {}

type ProductUpdatesSubmissionResult = ResultType<
  {
    email: string;
  },
  ProductUpdatesSubmissionError
>;

type ContactSubmissionResult = ResultType<void, ContactSubmissionError>;

function readLandingApiErrorMessage(
  response: LandingApiErrorResponse,
  fallback: string
): string {
  if (response.message.length) {
    return response.message;
  }

  return fallback;
}

async function submitProductUpdatesRequest(
  email: string
): Promise<ProductUpdatesSubmissionResult> {
  const responseResult = await Result.tryPromise({
    try: () =>
      landingApiClient.api["product-updates"].$post({
        json: { email },
      }),
    catch: (cause: unknown) =>
      new ProductUpdatesSubmissionError({
        cause,
        message: DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE,
      }),
  });
  if (responseResult.isErr()) {
    return Result.err(responseResult.error);
  }

  const response = responseResult.value;
  if (response.ok) {
    const body = await response.json();
    return Result.ok({
      email: body.email,
    });
  }

  const payload: LandingApiErrorResponse = await response.json();
  return Result.err(
    new ProductUpdatesSubmissionError({
      cause: response,
      message: readLandingApiErrorMessage(
        payload,
        DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE
      ),
    })
  );
}

async function submitContactRequest(
  form: ContactForm
): Promise<ContactSubmissionResult> {
  const responseResult = await Result.tryPromise({
    try: () =>
      landingApiClient.api.contact.$post({
        json: form,
      }),
    catch: (cause: unknown) =>
      new ContactSubmissionError({
        cause,
        message: DEFAULT_CONTACT_ERROR_MESSAGE,
      }),
  });
  if (responseResult.isErr()) {
    return Result.err(responseResult.error);
  }

  const response = responseResult.value;
  if (response.ok) {
    return Result.ok(undefined);
  }

  const payload: LandingApiErrorResponse = await response.json();
  return Result.err(
    new ContactSubmissionError({
      cause: response,
      message: readLandingApiErrorMessage(
        payload,
        DEFAULT_CONTACT_ERROR_MESSAGE
      ),
    })
  );
}

function runBestEffort(action: () => void) {
  try {
    action();
  } catch {
    // Comment: landing analytics is best-effort and should never block form
    // state transitions or RPC result handling.
  }
}

function useProductUpdatesController() {
  const actorRef = useActorRef(productUpdatesMachine);
  const email = useSelector(actorRef, (snapshot) => snapshot.context.email);
  const feedback = useSelector(actorRef, readProductUpdatesFeedback);
  const isSubmitting = useSelector(actorRef, (snapshot) =>
    snapshot.matches("submitting")
  );

  useMountEffect(() => {
    let isActive = true;
    let lastStartedSubmissionRequestId = 0;

    async function handleSnapshot(
      snapshot: ReturnType<typeof actorRef.getSnapshot>
    ) {
      const pendingSubmission = snapshot.context.pendingSubmission;

      if (
        !snapshot.matches("submitting") ||
        pendingSubmission === null ||
        pendingSubmission.requestId === lastStartedSubmissionRequestId
      ) {
        return;
      }

      lastStartedSubmissionRequestId = pendingSubmission.requestId;

      const result = await submitProductUpdatesRequest(pendingSubmission.email);

      if (!isActive) {
        return;
      }

      if (result.isErr()) {
        actorRef.send({
          type: "productUpdates/submissionFailed",
          message: result.error.message,
          requestId: pendingSubmission.requestId,
        });
        return;
      }

      actorRef.send({
        type: "productUpdates/submissionSucceeded",
        email: result.value.email,
        requestId: pendingSubmission.requestId,
      });
      runBestEffort(trackProductUpdatesSignup);
    }

    void handleSnapshot(actorRef.getSnapshot());

    const subscription = actorRef.subscribe((snapshot) => {
      void handleSnapshot(snapshot);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  });

  return {
    email,
    feedback,
    isSubmitting,
    setEmail: (nextEmail: string) => {
      actorRef.send({
        type: "productUpdates/emailChanged",
        email: nextEmail,
      });
    },
    submit: () => {
      actorRef.send({ type: "productUpdates/submit" });
    },
  };
}

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

function useContactModalController(): ContactModalController {
  const actorRef = useActorRef(contactModalMachine);
  const form = useSelector(actorRef, (snapshot) => snapshot.context.form);
  const errorMessage = useSelector(actorRef, readContactModalErrorMessage);
  const isOpen = useSelector(actorRef, (snapshot) => snapshot.matches("open"));
  const isSubmitting = useSelector(actorRef, (snapshot) =>
    snapshot.matches({ open: "submitting" })
  );

  useMountEffect(() => {
    let isActive = true;
    let lastStartedSubmissionRequestId = 0;

    async function handleSnapshot(
      snapshot: ReturnType<typeof actorRef.getSnapshot>
    ) {
      const pendingSubmission = snapshot.context.pendingSubmission;

      if (
        !snapshot.matches({ open: "submitting" }) ||
        pendingSubmission === null ||
        pendingSubmission.requestId === lastStartedSubmissionRequestId
      ) {
        return;
      }

      lastStartedSubmissionRequestId = pendingSubmission.requestId;

      const result = await submitContactRequest(pendingSubmission.form);

      if (!isActive) {
        return;
      }

      if (result.isErr()) {
        actorRef.send({
          type: "contactModal/submitFailed",
          message: result.error.message,
          requestId: pendingSubmission.requestId,
        });
        return;
      }

      actorRef.send({
        type: "contactModal/submitSucceeded",
        requestId: pendingSubmission.requestId,
      });
      runBestEffort(trackContactFormSubmitted);
    }

    void handleSnapshot(actorRef.getSnapshot());

    const subscription = actorRef.subscribe((snapshot) => {
      void handleSnapshot(snapshot);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  });

  return {
    errorMessage,
    form,
    isOpen,
    isSubmitting,
    close: () => {
      actorRef.send({ type: "contactModal/closeRequested" });
    },
    open: () => {
      runBestEffort(trackContactModalOpened);
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

export function ProductUpdatesSection() {
  const { email, feedback, isSubmitting, setEmail, submit } =
    useProductUpdatesController();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  return (
    <section className="section marketing-updates">
      <div className="marketing-updates-copy">
        <p className="eyebrow">Stay in the loop</p>
        <h2>Get product updates from OneQuery.</h2>
        <p>Join the list for release notes and new integrations.</p>
      </div>

      <form className="marketing-updates-form" onSubmit={handleSubmit}>
        <div className="marketing-inline-form">
          <input
            type="email"
            placeholder="you@company.com"
            className="marketing-input"
            aria-label="Email address"
            value={email}
            disabled={isSubmitting}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <button
            type="submit"
            className="button button-primary marketing-submit-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Notify me"}
          </button>
        </div>

        <p className={feedback.className} role={feedback.role}>
          {feedback.message}
        </p>
      </form>
    </section>
  );
}

export function FooterContactButton() {
  const controller = useContactModalController();

  return (
    <>
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

function ContactModal({ controller }: { controller: ContactModalController }) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
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
          ×
        </button>

        <div className="contact-modal-header">
          <p className="eyebrow">Start a conversation</p>
          <h2 id="contact-modal-title">Contact OneQuery</h2>
          <p className="contact-modal-copy">
            Tell us what you are trying to ship. We can help with self-hosting,
            integrations, and rollout questions.
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
              placeholder="Share your use case, timeline, or the integration you need."
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
