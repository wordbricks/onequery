import { ConnectError } from "@connectrpc/connect";

export type ContactState = {
  email: string;
  message: string;
  name: string;
};

type SubmissionState<Success> =
  | { tag: "idle" }
  | { tag: "submitting" }
  | { tag: "succeeded"; value: Success }
  | { tag: "failed"; message: string };

export type ProductUpdatesState = {
  email: string;
  submission: SubmissionState<{ email: string }>;
};

export type ProductUpdatesAction =
  | { type: "emailChanged"; email: string }
  | { type: "submitRequested" }
  | { type: "submitSucceeded"; email: string }
  | { type: "submitFailed"; message: string };

export type ContactModalState = {
  form: ContactState;
  isOpen: boolean;
  submission: SubmissionState<null>;
};

export type ContactModalAction =
  | { type: "closeRequested" }
  | { type: "fieldChanged"; field: keyof ContactState; value: string }
  | { type: "openRequested" }
  | { type: "submitFailed"; message: string }
  | { type: "submitRequested" }
  | { type: "submitSucceeded" };

export const emptyContactState: ContactState = {
  email: "",
  message: "",
  name: "",
};

export const initialProductUpdatesState: ProductUpdatesState = {
  email: "",
  submission: { tag: "idle" },
};

export const initialContactModalState: ContactModalState = {
  form: emptyContactState,
  isOpen: false,
  submission: { tag: "idle" },
};

export function productUpdatesReducer(
  state: ProductUpdatesState,
  action: ProductUpdatesAction
): ProductUpdatesState {
  switch (action.type) {
    case "emailChanged":
      return {
        email: action.email,
        submission: { tag: "idle" },
      };

    case "submitRequested":
      return {
        ...state,
        submission: { tag: "submitting" },
      };

    case "submitSucceeded":
      return {
        email: "",
        submission: {
          tag: "succeeded",
          value: { email: action.email },
        },
      };

    case "submitFailed":
      return {
        ...state,
        submission: {
          tag: "failed",
          message: action.message,
        },
      };

    default:
      return state;
  }
}

export function contactModalReducer(
  state: ContactModalState,
  action: ContactModalAction
): ContactModalState {
  switch (action.type) {
    case "openRequested":
      return {
        ...state,
        isOpen: true,
        submission: { tag: "idle" },
      };

    case "closeRequested":
      return initialContactModalState;

    case "fieldChanged":
      return {
        ...state,
        form: {
          ...state.form,
          [action.field]: action.value,
        },
        submission:
          state.submission.tag === "submitting"
            ? state.submission
            : { tag: "idle" },
      };

    case "submitRequested":
      return {
        ...state,
        submission: { tag: "submitting" },
      };

    case "submitSucceeded":
      return initialContactModalState;

    case "submitFailed":
      return {
        ...state,
        submission: {
          tag: "failed",
          message: action.message,
        },
      };

    default:
      return state;
  }
}

export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof ConnectError) {
    return error.rawMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}
