import { assertEvent, assign, fromPromise, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

export const DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE =
  "Failed to subscribe for product updates";

type ProductUpdatesFeedback =
  | { kind: "idle" }
  | {
      kind: "failure";
      message: string;
    }
  | {
      kind: "success";
      email: string;
    };

type ProductUpdatesContext = {
  email: string;
  feedback: ProductUpdatesFeedback;
};

type ProductUpdatesEvent =
  | {
      type: "productUpdates/emailChanged";
      email: string;
    }
  | {
      type: "productUpdates/submit";
    };

export type ProductUpdatesSubmissionInput = {
  email: string;
};

export type ProductUpdatesSubmissionOutput = {
  email: string;
};

function createInitialContext(): ProductUpdatesContext {
  return {
    email: "",
    feedback: createIdleFeedback(),
  };
}

function createIdleFeedback(): ProductUpdatesFeedback {
  return {
    kind: "idle",
  };
}

function readProductUpdatesSubmissionError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }

  return DEFAULT_PRODUCT_UPDATES_ERROR_MESSAGE;
}

const productUpdatesMachine = setup({
  types: {
    context: {} as ProductUpdatesContext,
    events: {} as ProductUpdatesEvent,
  },
  actions: {
    recordSuccess: assign({
      email: () => "",
      feedback: (_, params: ProductUpdatesSubmissionOutput) => ({
        kind: "success" as const,
        email: params.email,
      }),
    }),
    storeEmail: assign(({ event }) => {
      assertEvent(event, "productUpdates/emailChanged");
      return {
        email: event.email,
        feedback: createIdleFeedback(),
      };
    }),
    storeSubmitError: assign({
      feedback: (_, params: { error: unknown }) => ({
        kind: "failure" as const,
        message: readProductUpdatesSubmissionError(params.error),
      }),
    }),
    trackSubmissionSucceeded: () => undefined,
  },
  actors: {
    submitProductUpdates: fromPromise<
      ProductUpdatesSubmissionOutput,
      ProductUpdatesSubmissionInput
    >(async ({ input }) => ({
      email: input.email.trim().toLowerCase(),
    })),
  },
}).createMachine({
  id: "productUpdates",
  initial: "editing",
  context: () => createInitialContext(),
  states: {
    editing: {
      on: {
        "productUpdates/emailChanged": {
          actions: "storeEmail",
        },
        "productUpdates/submit": {
          target: "submitting",
        },
      },
    },
    submitting: {
      invoke: {
        src: "submitProductUpdates",
        input: ({ context, event }) => {
          assertEvent(event, "productUpdates/submit");

          return {
            email: context.email,
          };
        },
        onDone: {
          actions: [
            {
              type: "recordSuccess",
              params: ({ event }) => event.output,
            },
            "trackSubmissionSucceeded",
          ],
          target: "success",
        },
        onError: {
          actions: {
            type: "storeSubmitError",
            params: ({ event }) => ({
              error: event.error,
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
        "productUpdates/submit": {
          target: "submitting",
        },
      },
    },
    failure: {
      on: {
        "productUpdates/emailChanged": {
          actions: "storeEmail",
          target: "editing",
        },
        "productUpdates/submit": {
          target: "submitting",
        },
      },
    },
  },
});

export function createProductUpdatesMachine() {
  return productUpdatesMachine;
}

export function readProductUpdatesFeedback(
  snapshot: SnapshotFrom<ReturnType<typeof createProductUpdatesMachine>>
) {
  const { feedback } = snapshot.context;

  if (feedback.kind === "failure") {
    return {
      className: "marketing-form-feedback marketing-form-feedback-error",
      message: feedback.message,
      role: "alert" as const,
    };
  }

  if (feedback.kind === "success") {
    return {
      className: "marketing-form-feedback marketing-form-feedback-success",
      message: `We’ll send product updates to ${feedback.email}.`,
      role: "status" as const,
    };
  }

  return {
    className: "marketing-form-feedback",
    message: "We only use this to send product updates.",
    role: "status" as const,
  };
}
