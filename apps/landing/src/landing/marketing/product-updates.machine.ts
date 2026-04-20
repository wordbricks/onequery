import { assertEvent, assign, setup } from "xstate";
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

type PendingProductUpdatesSubmission = {
  email: string;
  requestId: number;
};

type ProductUpdatesContext = {
  email: string;
  feedback: ProductUpdatesFeedback;
  nextSubmissionRequestId: number;
  pendingSubmission: PendingProductUpdatesSubmission | null;
};

type ProductUpdatesEvent =
  | {
      type: "productUpdates/emailChanged";
      email: string;
    }
  | {
      type: "productUpdates/submit";
    }
  | {
      type: "productUpdates/submissionFailed";
      message: string;
      requestId: number;
    }
  | {
      type: "productUpdates/submissionSucceeded";
      email: string;
      requestId: number;
    };

function createInitialContext(): ProductUpdatesContext {
  return {
    email: "",
    feedback: createIdleFeedback(),
    nextSubmissionRequestId: 1,
    pendingSubmission: null,
  };
}

function createIdleFeedback(): ProductUpdatesFeedback {
  return {
    kind: "idle",
  };
}

export function createProductUpdatesMachine() {
  return setup({
    types: {
      context: {} as ProductUpdatesContext,
      events: {} as ProductUpdatesEvent,
    },
    actions: {
      clearPendingSubmission: assign({
        pendingSubmission: () => null,
      }),
      recordSuccess: assign({
        email: () => "",
        feedback: ({ context, event }) => {
          assertEvent(event, "productUpdates/submissionSucceeded");

          if (context.pendingSubmission?.requestId !== event.requestId) {
            return context.feedback;
          }

          return {
            kind: "success" as const,
            email: event.email,
          };
        },
      }),
      startSubmission: assign(({ context }) => ({
        nextSubmissionRequestId: context.nextSubmissionRequestId + 1,
        pendingSubmission: {
          email: context.email,
          requestId: context.nextSubmissionRequestId,
        },
      })),
      storeEmail: assign(({ event }) => {
        assertEvent(event, "productUpdates/emailChanged");
        return {
          email: event.email,
          feedback: createIdleFeedback(),
        };
      }),
      storeSubmitError: assign({
        feedback: ({ context, event }) => {
          assertEvent(event, "productUpdates/submissionFailed");

          if (context.pendingSubmission?.requestId !== event.requestId) {
            return context.feedback;
          }

          return {
            kind: "failure" as const,
            message: event.message,
          };
        },
      }),
    },
    guards: {
      matchesPendingSubmission: ({ context, event }) => {
        if (
          event.type !== "productUpdates/submissionFailed" &&
          event.type !== "productUpdates/submissionSucceeded"
        ) {
          return false;
        }

        return context.pendingSubmission?.requestId === event.requestId;
      },
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
          "productUpdates/submit": {
            actions: "startSubmission",
            target: "submitting",
          },
        },
      },
      submitting: {
        on: {
          "productUpdates/submissionFailed": {
            actions: ["storeSubmitError", "clearPendingSubmission"],
            guard: "matchesPendingSubmission",
            target: "failure",
          },
          "productUpdates/submissionSucceeded": {
            actions: ["recordSuccess", "clearPendingSubmission"],
            guard: "matchesPendingSubmission",
            target: "success",
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
            actions: "startSubmission",
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
            actions: "startSubmission",
            target: "submitting",
          },
        },
      },
    },
  });
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
