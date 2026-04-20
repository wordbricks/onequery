import { assertEvent, assign, fromPromise, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

import { toUserMessage } from "./marketing-errors";

const DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE =
  "Failed to subscribe for product updates";

type ProductUpdatesContext = {
  email: string;
  errorMessage: string | null;
  lastSubmittedEmail: string | null;
  successfulSubmissionCount: number;
};

type ProductUpdatesEvent =
  | {
      type: "productUpdates/emailChanged";
      email: string;
    }
  | {
      type: "productUpdates/submit";
    };

type ProductUpdatesDependencies = {
  subscribeProductUpdates: (input: { email: string }) => Promise<{
    email: string;
  }>;
};

function createInitialContext(): ProductUpdatesContext {
  return {
    email: "",
    errorMessage: null,
    lastSubmittedEmail: null,
    successfulSubmissionCount: 0,
  };
}

export function createProductUpdatesMachine(
  dependencies: ProductUpdatesDependencies
) {
  return setup({
    types: {
      context: {} as ProductUpdatesContext,
      events: {} as ProductUpdatesEvent,
    },
    actions: {
      recordSuccess: assign({
        email: () => "",
        errorMessage: () => null,
        lastSubmittedEmail: (_, params: { email: string }) => params.email,
        successfulSubmissionCount: ({ context }) =>
          context.successfulSubmissionCount + 1,
      }),
      storeSubmitError: assign({
        errorMessage: (_, params: { message: string }) => params.message,
        lastSubmittedEmail: () => null,
      }),
      storeEmail: assign(({ event }) => {
        assertEvent(event, "productUpdates/emailChanged");
        return {
          email: event.email,
          errorMessage: null,
          lastSubmittedEmail: null,
        };
      }),
    },
    actors: {
      submitProductUpdates: fromPromise<{ email: string }, { email: string }>(
        async ({ input }) => dependencies.subscribeProductUpdates(input)
      ),
    },
  }).createMachine({
    id: "productUpdates",
    initial: "editing",
    context: createInitialContext(),
    states: {
      editing: {
        on: {
          "productUpdates/emailChanged": {
            actions: "storeEmail",
          },
          "productUpdates/submit": "submitting",
        },
      },
      submitting: {
        invoke: {
          src: "submitProductUpdates",
          input: ({ context }) => ({
            email: context.email,
          }),
          onDone: {
            actions: {
              type: "recordSuccess",
              params: ({ event }) => ({
                email: event.output.email,
              }),
            },
            target: "success",
          },
          onError: {
            actions: {
              type: "storeSubmitError",
              params: ({ event }) => ({
                message: toUserMessage(
                  event.error,
                  DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE
                ),
              }),
            },
            target: "failure",
          },
        },
      },
      success: {
        on: {
          "productUpdates/emailChanged": {
            actions: "storeEmail",
            target: "editing",
          },
          "productUpdates/submit": "submitting",
        },
      },
      failure: {
        on: {
          "productUpdates/emailChanged": {
            actions: "storeEmail",
            target: "editing",
          },
          "productUpdates/submit": "submitting",
        },
      },
    },
  });
}

export function readProductUpdatesFeedback(
  snapshot: SnapshotFrom<ReturnType<typeof createProductUpdatesMachine>>
) {
  if (snapshot.matches("failure")) {
    return {
      className: "marketing-form-feedback marketing-form-feedback-error",
      message:
        snapshot.context.errorMessage ?? DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE,
      role: "alert" as const,
    };
  }

  if (snapshot.matches("success")) {
    return {
      className: "marketing-form-feedback marketing-form-feedback-success",
      message: `We’ll send product updates to ${snapshot.context.lastSubmittedEmail}.`,
      role: "status" as const,
    };
  }

  return {
    className: "marketing-form-feedback",
    message: "We only use this to send product updates.",
    role: "status" as const,
  };
}
