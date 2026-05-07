import { useActorRef, useSelector } from "@xstate/react";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import type { FormEvent } from "react";
import { fromPromise } from "xstate";

import { landingApiClient } from "../../app/runtime/landing-api-client";
import type { LandingApiErrorResponse } from "../../app/runtime/landing-api-client";
import { trackProductUpdatesSignup } from "../analytics/landing-analytics";
import {
  DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE,
  createProductUpdatesMachine,
  readProductUpdatesFeedback,
} from "./product-updates.machine";
import type {
  ProductUpdatesSubmissionInput,
  ProductUpdatesSubmissionOutput,
} from "./product-updates.machine";

class ProductUpdatesSubmissionError extends TaggedError(
  "ProductUpdatesSubmissionError"
)<{
  cause: unknown;
  message: string;
}>() {}

type ProductUpdatesSubmissionResult = ResultType<
  ProductUpdatesSubmissionOutput,
  ProductUpdatesSubmissionError
>;

function readLandingApiErrorMessage(
  response: LandingApiErrorResponse,
  fallback: string
): string {
  if (response.message.length) {
    return response.message;
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

async function submitProductUpdatesRequest(
  input: ProductUpdatesSubmissionInput & { signal: AbortSignal }
): Promise<ProductUpdatesSubmissionResult> {
  const responseResult = await Result.tryPromise({
    try: async () => {
      const response = await landingApiClient.api["product-updates"].$post(
        {
          json: { email: input.email },
        },
        {
          init: { signal: input.signal },
        }
      );

      if (response.ok) {
        const body = await response.json();
        return {
          email: body.email,
        };
      }

      const payload: LandingApiErrorResponse = await response.json();
      throw new ProductUpdatesSubmissionError({
        cause: response,
        message: readLandingApiErrorMessage(
          payload,
          DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE
        ),
      });
    },
    catch: (cause: unknown) =>
      cause instanceof ProductUpdatesSubmissionError
        ? cause
        : new ProductUpdatesSubmissionError({
            cause,
            message: DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE,
          }),
  });

  return responseResult;
}

const productUpdatesMachine = createProductUpdatesMachine().provide({
  actions: {
    trackSubmissionSucceeded: () => {
      runBestEffort(trackProductUpdatesSignup);
    },
  },
  actors: {
    submitProductUpdates: fromPromise<
      ProductUpdatesSubmissionOutput,
      ProductUpdatesSubmissionInput
    >(async ({ input, signal }) => {
      const result = await submitProductUpdatesRequest({
        ...input,
        signal,
      });

      if (result.isErr()) {
        throw result.error;
      }

      return result.value;
    }),
  },
});

function useProductUpdatesController() {
  const actorRef = useActorRef(productUpdatesMachine);
  const email = useSelector(actorRef, (snapshot) => snapshot.context.email);
  const feedback = useSelector(actorRef, readProductUpdatesFeedback);
  const isSubmitting = useSelector(actorRef, (snapshot) =>
    snapshot.matches("submitting")
  );

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

export function ProductUpdatesSection() {
  const { email, feedback, isSubmitting, setEmail, submit } =
    useProductUpdatesController();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  return (
    <section className="section marketing-updates">
      <div className="marketing-updates-copy">
        <p className="eyebrow">Stay in the loop</p>
        <h2>Get OneQuery updates.</h2>
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
