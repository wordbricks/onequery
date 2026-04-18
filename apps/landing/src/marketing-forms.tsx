import { ConnectError } from "@connectrpc/connect";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  trackContactFormSubmitted,
  trackContactModalOpened,
  trackProductUpdatesSignup,
} from "./analytics";
import { landingClient } from "./lib/connect-client";

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

function toUserMessage(error: unknown, fallback: string) {
  if (error instanceof ConnectError) {
    return error.rawMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function ProductUpdatesSection() {
  const [email, setEmail] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { email: string }) =>
      landingClient.subscribeProductUpdates({ email: input.email }),
    onSuccess(response) {
      trackProductUpdatesSignup();
      setEmail("");
      setSuccessMessage(`We’ll send product updates to ${response.email}.`);
    },
  });

  const errorMessage = mutation.isError
    ? toUserMessage(mutation.error, "Failed to subscribe for product updates")
    : null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccessMessage(null);
    mutation.mutate({ email });
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
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <button
            type="submit"
            className="button button-primary marketing-submit-button"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving..." : "Notify me"}
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
  const [form, setForm] = useState<ContactState>(emptyContactState);

  const mutation = useMutation({
    mutationFn: (input: ContactState) => landingClient.submitContact(input),
    onSuccess() {
      trackContactFormSubmitted();
      setForm(emptyContactState);
      onClose();
    },
  });

  const errorMessage = mutation.isError
    ? toUserMessage(mutation.error, "Failed to send message")
    : null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(form);
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
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Sending..." : "Send message"}
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
