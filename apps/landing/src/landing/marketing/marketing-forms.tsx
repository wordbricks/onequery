import { useMutation } from "@connectrpc/connect-query";
import { useEffect, useReducer } from "react";

import { LandingService } from "../../connect/gen/onequery/landing/v1/landing_pb";
import {
  trackContactFormSubmitted,
  trackContactModalOpened,
  trackProductUpdatesSignup,
} from "../analytics/landing-analytics";
import type {
  ContactModalAction,
  ContactModalState,
} from "./marketing-forms.machine";
import {
  contactModalReducer,
  initialContactModalState,
  initialProductUpdatesState,
  productUpdatesReducer,
  toUserMessage,
} from "./marketing-forms.machine";

export function ProductUpdatesSection() {
  const [state, dispatch] = useReducer(
    productUpdatesReducer,
    initialProductUpdatesState
  );

  const mutation = useMutation(LandingService.method.subscribeProductUpdates);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({ type: "submitRequested" });
    mutation.mutate(
      { email: state.email },
      {
        onError(error) {
          dispatch({
            type: "submitFailed",
            message: toUserMessage(
              error,
              "Failed to subscribe for product updates"
            ),
          });
        },
        onSuccess(response) {
          trackProductUpdatesSignup();
          dispatch({ type: "submitSucceeded", email: response.email });
        },
      }
    );
  }

  const feedbackClassName =
    state.submission.tag === "failed"
      ? "marketing-form-feedback marketing-form-feedback-error"
      : state.submission.tag === "succeeded"
        ? "marketing-form-feedback marketing-form-feedback-success"
        : "marketing-form-feedback";
  const feedbackMessage =
    state.submission.tag === "failed"
      ? state.submission.message
      : state.submission.tag === "succeeded"
        ? `We’ll send product updates to ${state.submission.value.email}.`
        : "We only use this to send product updates.";

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
            value={state.email}
            disabled={state.submission.tag === "submitting"}
            onChange={(event) =>
              dispatch({
                type: "emailChanged",
                email: event.currentTarget.value,
              })
            }
          />
          <button
            type="submit"
            className="button button-primary marketing-submit-button"
            disabled={state.submission.tag === "submitting"}
          >
            {state.submission.tag === "submitting" ? "Saving..." : "Notify me"}
          </button>
        </div>

        <p
          className={feedbackClassName}
          role={state.submission.tag === "failed" ? "alert" : "status"}
        >
          {feedbackMessage}
        </p>
      </form>
    </section>
  );
}

export function FooterContactButton() {
  const [state, dispatch] = useReducer(
    contactModalReducer,
    initialContactModalState
  );

  useEffect(() => {
    if (!state.isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dispatch({ type: "closeRequested" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [state.isOpen]);

  return (
    <>
      <button
        type="button"
        className="contact-link-button"
        onClick={() => {
          trackContactModalOpened();
          dispatch({ type: "openRequested" });
        }}
      >
        Contact
      </button>
      {state.isOpen ? <ContactModal state={state} dispatch={dispatch} /> : null}
    </>
  );
}

function ContactModal({
  dispatch,
  state,
}: {
  dispatch: React.Dispatch<ContactModalAction>;
  state: ContactModalState;
}) {
  const mutation = useMutation(LandingService.method.submitContact);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({ type: "submitRequested" });
    mutation.mutate(state.form, {
      onError(error) {
        dispatch({
          type: "submitFailed",
          message: toUserMessage(error, "Failed to send message"),
        });
      },
      onSuccess() {
        trackContactFormSubmitted();
        dispatch({ type: "submitSucceeded" });
      },
    });
  }

  return (
    <div
      className="contact-modal-backdrop"
      role="presentation"
      onMouseDown={() => dispatch({ type: "closeRequested" })}
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
          onClick={() => dispatch({ type: "closeRequested" })}
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
                disabled={state.submission.tag === "submitting"}
                value={state.form.name}
                onChange={(event) =>
                  dispatch({
                    type: "fieldChanged",
                    field: "name",
                    value: event.currentTarget.value,
                  })
                }
              />
            </label>

            <label className="contact-modal-field">
              <span className="contact-modal-label">Email</span>
              <input
                type="email"
                placeholder="you@company.com"
                className="contact-modal-input"
                disabled={state.submission.tag === "submitting"}
                value={state.form.email}
                onChange={(event) =>
                  dispatch({
                    type: "fieldChanged",
                    field: "email",
                    value: event.currentTarget.value,
                  })
                }
              />
            </label>
          </div>

          <label className="contact-modal-field">
            <span className="contact-modal-label">Message</span>
            <textarea
              placeholder="Share your use case, timeline, or the integration you need."
              className="contact-modal-textarea"
              disabled={state.submission.tag === "submitting"}
              value={state.form.message}
              onChange={(event) =>
                dispatch({
                  type: "fieldChanged",
                  field: "message",
                  value: event.currentTarget.value,
                })
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
              disabled={state.submission.tag === "submitting"}
            >
              {state.submission.tag === "submitting"
                ? "Sending..."
                : "Send message"}
            </button>
            {state.submission.tag === "failed" ? (
              <p className="marketing-form-feedback marketing-form-feedback-error">
                {state.submission.message}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
