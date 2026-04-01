import type { InferResponseType } from "hono/client";
import { assertEvent, assign, fromPromise, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

import { createApiClient } from "@/lib/api-client";

import { normalizeDeviceUserCode } from "./device-auth-schema";

export type DeviceResultTone = "success" | "error";

export type DeviceResult = {
  title: string;
  message: string;
  tone: DeviceResultTone;
};

type DeviceSession =
  | { kind: "pending" }
  | { kind: "signedOut" }
  | { kind: "signedIn"; email: string };

type DeviceDecisionAction = "approve" | "deny";

type DeviceNavigation = {
  id: number;
  userCode: string | null;
  replace: boolean;
  phase: "pending" | "running";
};

type DeviceAuthContext = {
  inputCode: string;
  activeUserCode: string | null;
  error: string | null;
  result: DeviceResult | null;
  session: DeviceSession;
  decisionAction: DeviceDecisionAction | null;
  navigation: DeviceNavigation | null;
  nextNavigationId: number;
};

type DeviceAuthEvent =
  | { type: "deviceAuth/routeSynced"; userCode: string | null }
  | { type: "deviceAuth/inputChanged"; value: string }
  | { type: "deviceAuth/submit" }
  | { type: "deviceAuth/navigationStarted"; id: number }
  | { type: "deviceAuth/navigationCompleted"; id: number }
  | { type: "deviceAuth/navigationFailed"; id: number; message: string }
  | { type: "deviceAuth/sessionSynced"; session: DeviceSession }
  | { type: "deviceAuth/approve" }
  | { type: "deviceAuth/deny" }
  | { type: "deviceAuth/useDifferentCode" };

type DeviceAuthTypes = {
  context: DeviceAuthContext;
  events: DeviceAuthEvent;
};

type VerifyDeviceOutput =
  | {
      kind: "verified";
      status: "pending" | "approved" | "denied";
      userCode: string;
    }
  | {
      kind: "error";
      message: string;
    };

type SubmitDecisionOutput =
  | {
      kind: "success";
      title: string;
      message: string;
      tone: DeviceResultTone;
    }
  | {
      kind: "error";
      message: string;
    };

export type DevicePanelView =
  | "entry"
  | "verifying"
  | "sessionCheck"
  | "signInRequired"
  | "review"
  | "result";

const deviceClient = createApiClient();
type VerifyDeviceGet = (typeof deviceClient.api.device.verify)["$get"];
type VerifyDeviceSuccessResponse = InferResponseType<VerifyDeviceGet, 200>;
type VerifyDeviceResponse = InferResponseType<VerifyDeviceGet>;
type SubmitDeviceDecisionSuccessResponse = InferResponseType<
  (typeof deviceClient.api.device.approve)["$post"],
  200
>;
type SubmitDeviceDecisionResponse = InferResponseType<
  (typeof deviceClient.api.device.approve)["$post"]
>;

// Comment: these device routes do not use Hono validators yet, so RPC gives us
// precise response inference while the request payload shapes still stay local.

const GENERIC_DEVICE_VERIFY_ERROR_MESSAGE =
  "The device code could not be verified. Try again.";
const GENERIC_DEVICE_DECISION_ERROR_MESSAGE =
  "The device request could not be completed. Try again.";

function createInitialContext(): DeviceAuthContext {
  return {
    activeUserCode: null,
    decisionAction: null,
    error: null,
    inputCode: "",
    navigation: null,
    nextNavigationId: 1,
    result: null,
    session: { kind: "pending" },
  };
}

function resetFlowContext(context: DeviceAuthContext): DeviceAuthContext {
  return {
    ...createInitialContext(),
    nextNavigationId: context.nextNavigationId,
  };
}

function queueNavigation(
  context: Pick<DeviceAuthContext, "nextNavigationId">,
  userCode: string | null,
  replace: boolean
): Pick<DeviceAuthContext, "navigation" | "nextNavigationId"> {
  return {
    navigation: {
      id: context.nextNavigationId,
      phase: "pending" as const,
      replace,
      userCode,
    },
    nextNavigationId: context.nextNavigationId + 1,
  };
}

const verifyDeviceActor = fromPromise<
  VerifyDeviceOutput,
  { userCode: string | null }
>(async ({ input }) => {
  if (!input.userCode) {
    return {
      kind: "error",
      message: "Enter the code shown in your terminal to continue.",
    };
  }

  try {
    const response = await deviceClient.api.device.verify.$get({
      query: {
        user_code: input.userCode,
      },
    });

    if (!response.ok) {
      const payload: VerifyDeviceResponse | null = await response
        .json()
        .catch(() => null);
      return {
        kind: "error",
        message: readDeviceErrorMessage(
          payload,
          GENERIC_DEVICE_VERIFY_ERROR_MESSAGE
        ),
      };
    }

    const payload: VerifyDeviceSuccessResponse = await response.json();

    return {
      kind: "verified",
      status: payload.status,
      userCode: payload.userCode,
    };
  } catch (error) {
    console.error("[device-auth] failed to verify device code", {
      errorName: readErrorName(error),
    });
    return {
      kind: "error",
      message: GENERIC_DEVICE_VERIFY_ERROR_MESSAGE,
    };
  }
});

const submitDecisionActor = fromPromise<
  SubmitDecisionOutput,
  { action: "approve" | "deny"; userCode: string | null }
>(async ({ input }) => {
  if (!input.userCode) {
    return {
      kind: "error",
      message: "The device request could not be completed. Try again.",
    };
  }

  try {
    const submitDecision =
      input.action === "approve"
        ? deviceClient.api.device.approve.$post
        : deviceClient.api.device.deny.$post;
    const response = await submitDecision({
      form: {
        user_code: input.userCode,
      },
    });

    if (!response.ok) {
      const payload: SubmitDeviceDecisionResponse | null = await response
        .json()
        .catch(() => null);
      return {
        kind: "error",
        message: readDeviceErrorMessage(
          payload,
          GENERIC_DEVICE_DECISION_ERROR_MESSAGE
        ),
      };
    }

    const payload: SubmitDeviceDecisionSuccessResponse = await response.json();

    return {
      kind: "success",
      message: payload.message,
      title: payload.title,
      tone: input.action === "approve" ? "success" : "error",
    };
  } catch (error) {
    console.error("[device-auth] failed to submit device decision", {
      action: input.action,
      errorName: readErrorName(error),
    });
    return {
      kind: "error",
      message: GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
    };
  }
});

export const deviceAuthMachine = setup({
  actions: {
    resetToEntry: assign(({ context }) => resetFlowContext(context)),
    syncRouteToVerification: assign(({ event }) => {
      assertEvent(event, "deviceAuth/routeSynced");
      if (event.userCode === null) {
        return {};
      }

      return {
        inputCode: event.userCode,
        activeUserCode: event.userCode,
        error: null,
        result: null,
        decisionAction: null,
        navigation: null,
      };
    }),
    setInputCode: assign(({ event }) => {
      assertEvent(event, "deviceAuth/inputChanged");
      return {
        inputCode: event.value,
        error: null,
      };
    }),
    stageVerificationFromInput: assign(({ context }) => {
      const userCode = normalizeUserCode(context.inputCode);
      if (userCode === null) {
        return {};
      }

      return {
        inputCode: userCode,
        activeUserCode: userCode,
        error: null,
        result: null,
        decisionAction: null,
        ...queueNavigation(context, userCode, false),
      };
    }),
    setMissingCodeError: assign({
      error: () => "Enter the code shown in your terminal to continue.",
    }),
    syncSession: assign(({ event }) => {
      assertEvent(event, "deviceAuth/sessionSynced");
      return {
        session: event.session,
        error: null,
      };
    }),
    queueClearCodeNavigation: assign(({ context }) => {
      const resetContext = resetFlowContext(context);
      return {
        ...resetContext,
        ...queueNavigation(resetContext, null, false),
      };
    }),
    stageApproveDecision: assign({
      decisionAction: () => "approve",
      error: () => null,
    }),
    stageDenyDecision: assign({
      decisionAction: () => "deny",
      error: () => null,
    }),
    markNavigationRunning: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/navigationStarted");
      if (context.navigation === null || context.navigation.id !== event.id) {
        return {};
      }

      return {
        navigation: {
          ...context.navigation,
          phase: "running" as const,
        },
      };
    }),
    completeNavigation: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/navigationCompleted");
      if (context.navigation === null || context.navigation.id !== event.id) {
        return {};
      }

      return {
        navigation: null,
      };
    }),
    failNavigation: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/navigationFailed");
      if (context.navigation === null || context.navigation.id !== event.id) {
        return {};
      }

      return {
        navigation: null,
        error: event.message,
      };
    }),
  },
  actors: {
    verifyCode: verifyDeviceActor,
    submitDecision: submitDecisionActor,
  },
  guards: {
    routeCleared: ({ event }) =>
      event.type === "deviceAuth/routeSynced" && event.userCode === null,
    routeChanged: ({ context, event }) =>
      event.type === "deviceAuth/routeSynced" &&
      event.userCode !== null &&
      event.userCode !== context.activeUserCode,
    hasNormalizedInputCode: ({ context }) =>
      normalizeUserCode(context.inputCode) !== null,
    sessionSignedIn: ({ event }) =>
      event.type === "deviceAuth/sessionSynced" &&
      event.session.kind === "signedIn",
    sessionSignedOut: ({ event }) =>
      event.type === "deviceAuth/sessionSynced" &&
      event.session.kind === "signedOut",
  },
  types: {} as DeviceAuthTypes,
}).createMachine({
  context: createInitialContext(),
  id: "deviceAuth",
  initial: "entry",
  on: {
    "deviceAuth/routeSynced": [
      {
        guard: "routeCleared",
        target: ".entry",
        actions: "resetToEntry",
      },
      {
        guard: "routeChanged",
        target: ".verifying",
        actions: "syncRouteToVerification",
      },
    ],
    "deviceAuth/navigationStarted": {
      actions: "markNavigationRunning",
    },
    "deviceAuth/navigationCompleted": {
      actions: "completeNavigation",
    },
    "deviceAuth/navigationFailed": {
      actions: "failNavigation",
    },
  },
  states: {
    entry: {
      on: {
        "deviceAuth/inputChanged": {
          actions: "setInputCode",
        },
        "deviceAuth/submit": [
          {
            guard: "hasNormalizedInputCode",
            target: "verifying",
            actions: "stageVerificationFromInput",
          },
          {
            actions: "setMissingCodeError",
          },
        ],
      },
    },
    verifying: {
      invoke: {
        src: "verifyCode",
        input: ({ context }) => ({
          userCode: context.activeUserCode,
        }),
        onDone: [
          {
            guard: ({ event }) => isVerifyError(event.output),
            target: "entry",
            actions: assign(({ context, event }) => ({
              inputCode: context.activeUserCode ?? context.inputCode,
              error: readVerifyErrorMessage(event.output),
              result: null,
              decisionAction: null,
            })),
          },
          {
            guard: ({ event }) => isVerifiedPending(event.output),
            target: "pending",
            actions: assign(({ context, event }) =>
              readVerifiedTransition({
                context,
                output: event.output,
                result: null,
              })
            ),
          },
          {
            guard: ({ event }) => isVerifiedApproved(event.output),
            target: "result",
            actions: assign(({ context, event }) =>
              readVerifiedTransition({
                context,
                output: event.output,
                result: {
                  title: "Device Approved",
                  message:
                    "Return to your terminal to continue. You can close this tab.",
                  tone: "success",
                },
              })
            ),
          },
          {
            target: "result",
            actions: assign(({ context, event }) =>
              readVerifiedTransition({
                context,
                output: event.output,
                result: {
                  title: "Device Denied",
                  message:
                    "This device code has already been denied. Start onequery auth login again if you need a new code.",
                  tone: "error",
                },
              })
            ),
          },
        ],
      },
    },
    pending: {
      initial: "sessionCheck",
      on: {
        "deviceAuth/sessionSynced": [
          {
            guard: "sessionSignedIn",
            target: ".review",
            actions: "syncSession",
          },
          {
            guard: "sessionSignedOut",
            target: ".signInRequired",
            actions: "syncSession",
          },
          {
            target: ".sessionCheck",
            actions: "syncSession",
          },
        ],
        "deviceAuth/useDifferentCode": {
          target: "#deviceAuth.entry",
          actions: "queueClearCodeNavigation",
        },
      },
      states: {
        sessionCheck: {},
        signInRequired: {},
        review: {
          on: {
            "deviceAuth/approve": {
              target: "submittingDecision",
              actions: "stageApproveDecision",
            },
            "deviceAuth/deny": {
              target: "submittingDecision",
              actions: "stageDenyDecision",
            },
          },
        },
        submittingDecision: {
          invoke: {
            src: "submitDecision",
            input: ({ context }) => ({
              action: readDecisionAction(context),
              userCode: context.activeUserCode,
            }),
            onDone: [
              {
                guard: ({ event }) => isDecisionError(event.output),
                target: "#deviceAuth.entry",
                actions: assign(({ context, event }) => ({
                  inputCode: context.activeUserCode ?? "",
                  error: readDecisionErrorMessage(event.output),
                  result: null,
                  decisionAction: null,
                })),
              },
              {
                target: "#deviceAuth.result",
                actions: assign(({ event }) => ({
                  error: null,
                  result: readDecisionResult(event.output),
                  decisionAction: null,
                })),
              },
            ],
          },
        },
      },
    },
    result: {
      on: {
        "deviceAuth/useDifferentCode": {
          target: "entry",
          actions: "queueClearCodeNavigation",
        },
      },
    },
  },
});

type DeviceAuthSnapshot = SnapshotFrom<typeof deviceAuthMachine>;

export function readPanelView(snapshot: DeviceAuthSnapshot): DevicePanelView {
  if (snapshot.matches("entry")) {
    return "entry";
  }
  if (snapshot.matches("verifying")) {
    return "verifying";
  }
  if (snapshot.matches({ pending: "sessionCheck" })) {
    return "sessionCheck";
  }
  if (snapshot.matches({ pending: "signInRequired" })) {
    return "signInRequired";
  }
  if (
    snapshot.matches({ pending: "review" }) ||
    snapshot.matches({ pending: "submittingDecision" })
  ) {
    return "review";
  }
  return "result";
}

export function readSessionEmail(snapshot: DeviceAuthSnapshot) {
  return snapshot.context.session.kind === "signedIn"
    ? snapshot.context.session.email
    : null;
}

function normalizeUserCode(value: string | null) {
  return normalizeDeviceUserCode(value) ?? null;
}

export function readSessionSnapshot(input: {
  isSessionPending: boolean;
  email: string | null;
}): DeviceSession {
  if (input.isSessionPending) {
    return { kind: "pending" };
  }
  if (input.email) {
    return {
      email: input.email,
      kind: "signedIn",
    };
  }
  return { kind: "signedOut" };
}

export function readNavigationErrorMessage(_error: unknown) {
  return "Couldn't update the device URL. Try the same action again.";
}

function readDeviceErrorMessage(
  payload: VerifyDeviceResponse | SubmitDeviceDecisionResponse | null,
  fallback: string
) {
  if (!payload) {
    return fallback;
  }

  // Comment: device auth errors can originate from server-side auth checks, so
  // keep browser-visible failures generic instead of forwarding raw payload
  // strings that may expose internal auth or validation details.
  return "error" in payload ? fallback : fallback;
}

function readDecisionAction(context: DeviceAuthContext): DeviceDecisionAction {
  if (context.decisionAction === null) {
    throw new Error("Decision action is required before submitting.");
  }

  return context.decisionAction;
}

function readVerifiedTransition(input: {
  context: DeviceAuthContext;
  output: VerifyDeviceOutput;
  result: DeviceResult | null;
}) {
  const userCode = readVerifiedUserCode(
    input.output,
    input.context.activeUserCode
  );

  return {
    activeUserCode: userCode,
    decisionAction: null,
    error: null,
    inputCode: userCode ?? input.context.inputCode,
    result: input.result,
    ...(shouldReplaceNavigation(input.context.activeUserCode, input.output) &&
    userCode !== null
      ? queueNavigation(input.context, userCode, true)
      : {
          navigation: null,
          nextNavigationId: input.context.nextNavigationId,
        }),
  };
}

function isVerifyError(output: VerifyDeviceOutput): output is {
  kind: "error";
  message: string;
} {
  return output.kind === "error";
}

function isVerifiedPending(output: VerifyDeviceOutput): output is {
  kind: "verified";
  status: "pending";
  userCode: string;
} {
  return output.kind === "verified" && output.status === "pending";
}

function isVerifiedApproved(output: VerifyDeviceOutput): output is {
  kind: "verified";
  status: "approved";
  userCode: string;
} {
  return output.kind === "verified" && output.status === "approved";
}

function readVerifyErrorMessage(output: VerifyDeviceOutput) {
  return output.kind === "error"
    ? output.message
    : "The device code could not be verified. Try again.";
}

function readVerifiedUserCode(
  output: VerifyDeviceOutput,
  fallback: string | null
) {
  return output.kind === "verified" ? output.userCode : fallback;
}

function shouldReplaceNavigation(
  activeUserCode: string | null,
  output: VerifyDeviceOutput
) {
  return output.kind === "verified" && output.userCode !== activeUserCode;
}

function isDecisionError(output: SubmitDecisionOutput): output is {
  kind: "error";
  message: string;
} {
  return output.kind === "error";
}

function readDecisionErrorMessage(output: SubmitDecisionOutput) {
  return output.kind === "error"
    ? output.message
    : "The device request could not be completed. Try again.";
}

function readDecisionResult(output: SubmitDecisionOutput): DeviceResult {
  if (output.kind === "success") {
    return {
      message: output.message,
      title: output.title,
      tone: output.tone,
    };
  }

  return {
    message: output.message,
    title: "Device Request Failed",
    tone: "error",
  };
}

function readErrorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}
