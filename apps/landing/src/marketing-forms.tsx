import { useEffect, useState } from "react";

import {
  trackContactFormSubmitted,
  trackContactModalOpened,
  trackProductUpdatesSignup,
} from "./analytics";
import {
  getFirstLeadCaptureError,
  validateContactForm,
  validateProductUpdatesForm,
} from "./lead-capture";
import { submitContactForm, submitProductUpdates } from "./marketing-api";

type ProductUpdatesState = {
  email: string;
};

type ContactState = {
  email: string;
  message: string;
  name: string;
};

const emptyContactState: ContactState = {
  email: "",
  message: "",
  name: "",
};

export function ProductUpdatesSection() {
  const [form, setForm] = useState<ProductUpdatesState>({ email: "" });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const result = validateProductUpdatesForm(form);
    if (!result.ok) {
      setErrorMessage(getFirstLeadCaptureError(result.errors));
      return;
    }

    setIsPending(true);
    try {
      await submitProductUpdates(result.value);
      trackProductUpdatesSignup();
      setForm({ email: "" });
      setSuccessMessage(`We’ll send product updates to ${result.value.email}.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to subscribe for product updates"
      );
    } finally {
      setIsPending(false);
    }
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
            value={form.email}
            onChange={(event) => setForm({ email: event.currentTarget.value })}
          />
          <button
            type="submit"
            className="button button-primary marketing-submit-button"
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Notify me"}
          </button>
        </div>

        <p
          className={
            errorMessage
              ? "marketing-form-feedback marketing-form-feedback-error"
              : successMessage
                ? "marketing-form-feedback marketing-form-feedback-success"
                : "marketing-form-feedback"
          }
          role={errorMessage ? "alert" : "status"}
        >
          {errorMessage ??
            successMessage ??
            "We only use this to send product updates."}
        </p>
      </form>
    </section>
  );
}

export function FooterContactButton() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        className="contact-link-button"
        onClick={() => {
          trackContactModalOpened();
          setIsOpen(true);
        }}
      >
        Contact
      </button>
      {isOpen ? <ContactModal onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}

function ContactModal({ onClose }: { onClose: () => void }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [form, setForm] = useState<ContactState>(emptyContactState);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const result = validateContactForm(form);
    if (!result.ok) {
      setErrorMessage(getFirstLeadCaptureError(result.errors));
      return;
    }

    setIsPending(true);
    try {
      await submitContactForm(result.value);
      trackContactFormSubmitted();
      setForm(emptyContactState);
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to send message"
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div
      className="contact-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
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
          onClick={onClose}
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
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.currentTarget.value,
                  }))
                }
              />
            </label>

            <label className="contact-modal-field">
              <span className="contact-modal-label">Email</span>
              <input
                type="email"
                placeholder="you@company.com"
                className="contact-modal-input"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.currentTarget.value,
                  }))
                }
              />
            </label>
          </div>

          <label className="contact-modal-field">
            <span className="contact-modal-label">Message</span>
            <textarea
              placeholder="Share your use case, timeline, or the integration you need."
              className="contact-modal-textarea"
              value={form.message}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  message: event.currentTarget.value,
                }))
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
              disabled={isPending}
            >
              {isPending ? "Sending..." : "Send message"}
            </button>
            {errorMessage ? (
              <p className="marketing-form-feedback marketing-form-feedback-error">
                {errorMessage}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
