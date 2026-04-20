import { createClient } from "@connectrpc/connect";
import { useActorRef, useSelector } from "@xstate/react";
import { useEffect } from "react";

import { landingTransport } from "../../app/runtime/connect-transport";
import { LandingService } from "../../connect/gen/onequery/landing/v1/landing_pb";
import {
  trackContactFormSubmitted,
  trackContactModalOpened,
  trackProductUpdatesSignup,
} from "../analytics/landing-analytics";
import type { ContactForm } from "./contact-modal.machine";
import {
  createContactModalMachine,
  readContactModalErrorMessage,
} from "./contact-modal.machine";
import {
  createProductUpdatesMachine,
  readProductUpdatesFeedback,
} from "./product-updates.machine";

const landingClient = createClient(LandingService, landingTransport);
const productUpdatesMachine = createProductUpdatesMachine({
  async subscribeProductUpdates({ email }) {
    const response = await landingClient.subscribeProductUpdates({
      email,
    });

    return {
      email: response.email,
    };
  },
});
const contactModalMachine = createContactModalMachine({
  async submitContact(form) {
    await landingClient.submitContact(form);
  },
});

function useProductUpdatesController() {
  const actorRef = useActorRef(productUpdatesMachine);
  const email = useSelector(actorRef, (snapshot) => snapshot.context.email);
  const feedback = useSelector(actorRef, readProductUpdatesFeedback);
  const isSubmitting = useSelector(actorRef, (snapshot) =>
    snapshot.matches("submitting")
  );
  const successfulSubmissionCount = useSelector(
    actorRef,
    (snapshot) => snapshot.context.successfulSubmissionCount
  );

  useEffect(() => {
    if (successfulSubmissionCount === 0) {
      return;
    }

    trackProductUpdatesSignup();
  }, [successfulSubmissionCount]);

  return {
    email,
    feedback,
    isSubmitting,
    setEmail(nextEmail: string) {
      actorRef.send({
        type: "productUpdates/emailChanged",
        email: nextEmail,
      });
    },
    submit() {
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
  const successfulSubmissionCount = useSelector(
    actorRef,
    (snapshot) => snapshot.context.successfulSubmissionCount
  );

  useEffect(() => {
    if (successfulSubmissionCount === 0) {
      return;
    }

    trackContactFormSubmitted();
  }, [successfulSubmissionCount]);

  return {
    errorMessage,
    form,
    isOpen,
    isSubmitting,
    close() {
      actorRef.send({ type: "contactModal/closeRequested" });
    },
    open() {
      trackContactModalOpened();
      actorRef.send({ type: "contactModal/openRequested" });
    },
    setField(field, value) {
      actorRef.send({
        type: "contactModal/fieldChanged",
        field,
        value,
      });
    },
    submit() {
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
