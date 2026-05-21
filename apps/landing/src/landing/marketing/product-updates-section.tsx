import { useActorRef, useSelector } from "@xstate/react";
import { actions, isInputError } from "astro:actions";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import type { FormEvent } from "react";
import { fromPromise } from "xstate";

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

async function submitProductUpdatesRequest(
  input: ProductUpdatesSubmissionInput & { signal: AbortSignal }
): Promise<ProductUpdatesSubmissionResult> {
  const responseResult = await Result.tryPromise({
    try: async () => {
      input.signal.throwIfAborted();

      const result = await actions.productUpdates({ email: input.email });
      if (result.error) {
        throw new ProductUpdatesSubmissionError({
          cause: result.error,
          message: readActionErrorMessage(
            result.error,
            DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE
          ),
        });
      }

      return {
        email: result.data.email,
      };
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
