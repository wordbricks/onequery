import { normalizeDeviceUserCode } from "@onequery/base/device-auth";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import type { InferResponseType } from "hono/client";
import { assertEvent, assign, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

import { createApiClient } from "@/lib/api-client";

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

type DeviceVerificationRequest = {
  requestId: number;
  userCode: string | null;
};

type DeviceDecisionRequest = {
  action: DeviceDecisionAction;
  requestId: number;
  userCode: string | null;
};

type DeviceAuthAlert =
  | { kind: "idle" }
  | {
      kind: "error";
      message: string;
    };

type DeviceAuthResultState =
  | { kind: "idle" }
  | {
      kind: "ready";
      result: DeviceResult;
    };

type DeviceAuthContext = {
  inputCode: string;
  activeUserCode: string | null;
  alert: DeviceAuthAlert;
  resultState: DeviceAuthResultState;
  session: DeviceSession;
  navigation: DeviceNavigation | null;
  nextNavigationId: number;
  nextAsyncRequestId: number;
  pendingVerification: DeviceVerificationRequest | null;
  pendingDecision: DeviceDecisionRequest | null;
};

type DeviceAuthEvent =
  | { type: "deviceAuth/routeSynced"; userCode: string | null }
  | { type: "deviceAuth/inputChanged"; value: string }
  | { type: "deviceAuth/submit" }
  | {
      type: "deviceAuth/verificationFailed";
      message: string;
      requestId: number;
    }
  | {
      type: "deviceAuth/verificationSucceeded";
      requestId: number;
      status: "pending" | "approved" | "denied";
      userCode: string;
    }
  | { type: "deviceAuth/navigationStarted"; id: number }
  | { type: "deviceAuth/navigationCompleted"; id: number }
  | { type: "deviceAuth/navigationFailed"; id: number; message: string }
  | { type: "deviceAuth/sessionSynced"; session: DeviceSession }
  | { type: "deviceAuth/approve" }
  | { type: "deviceAuth/deny" }
  | {
      type: "deviceAuth/decisionFailed";
      message: string;
      requestId: number;
    }
  | {
      type: "deviceAuth/decisionSucceeded";
      message: string;
      requestId: number;
      title: string;
      tone: DeviceResultTone;
    }
  | { type: "deviceAuth/useDifferentCode" };

type DeviceAuthTypes = {
  context: DeviceAuthContext;
  events: DeviceAuthEvent;
};

export type DevicePanelView =
  | "entry"
  | "verifying"
  | "sessionCheck"
  | "signInRequired"
  | "review"
  | "result";

type DeviceClient = ReturnType<typeof createApiClient>;
type VerifyDeviceGet = DeviceClient["api"]["device"]["verify"]["$get"];
type VerifyDeviceSuccessResponse = InferResponseType<VerifyDeviceGet, 200>;
type VerifyDeviceResponse = InferResponseType<VerifyDeviceGet>;
type SubmitDeviceDecisionSuccessResponse = InferResponseType<
  DeviceClient["api"]["device"]["approve"]["$post"],
  200
>;
type SubmitDeviceDecisionResponse = InferResponseType<
  DeviceClient["api"]["device"]["approve"]["$post"]
>;

// Comment: these device routes do not use Hono validators yet, so RPC gives us
// precise response inference while the request payload shapes still stay local.

const GENERIC_DEVICE_VERIFY_ERROR_MESSAGE =
  "The device code could not be verified. Try again.";
const GENERIC_DEVICE_DECISION_ERROR_MESSAGE =
  "The device request could not be completed. Try again.";

class DeviceVerificationError extends TaggedError("DeviceVerificationError")<{
  cause?: unknown;
  message: string;
  reason: "missing_code" | "request_failed" | "response_failed";
}>() {}

class DeviceDecisionError extends TaggedError("DeviceDecisionError")<{
  action: DeviceDecisionAction;
  cause?: unknown;
  message: string;
  reason: "missing_code" | "request_failed" | "response_failed";
}>() {}

type VerifyDeviceRequestResult = ResultType<
  {
    status: "pending" | "approved" | "denied";
    userCode: string;
  },
  DeviceVerificationError
>;

type SubmitDecisionRequestResult = ResultType<
  {
    title: string;
    message: string;
    tone: DeviceResultTone;
  },
  DeviceDecisionError
>;

function createIdleDeviceAuthAlert(): DeviceAuthAlert {
  return {
    kind: "idle",
  };
}

function createDeviceAuthErrorAlert(message: string): DeviceAuthAlert {
  return {
    kind: "error",
    message,
  };
}

function createIdleDeviceAuthResultState(): DeviceAuthResultState {
  return {
    kind: "idle",
  };
}

function createReadyDeviceAuthResultState(
  result: DeviceResult
): DeviceAuthResultState {
  return {
    kind: "ready",
    result,
  };
}

function createInitialContext(): DeviceAuthContext {
  return {
    activeUserCode: null,
    alert: createIdleDeviceAuthAlert(),
    inputCode: "",
    navigation: null,
    nextAsyncRequestId: 1,
    nextNavigationId: 1,
    pendingDecision: null,
    pendingVerification: null,
    resultState: createIdleDeviceAuthResultState(),
    session: { kind: "pending" },
  };
}

function resetFlowContext(
  context: Pick<DeviceAuthContext, "nextAsyncRequestId" | "nextNavigationId">
): DeviceAuthContext {
  return {
    ...createInitialContext(),
    nextAsyncRequestId: context.nextAsyncRequestId,
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

export async function verifyDeviceRequest(
  userCode: string | null
): Promise<VerifyDeviceRequestResult> {
  const deviceClient = createApiClient();

  if (!userCode) {
    return Result.err(
      new DeviceVerificationError({
        message: "Enter the code shown in your terminal to continue.",
        reason: "missing_code",
      })
    );
  }

  const responseResult = await Result.tryPromise({
    try: () =>
      deviceClient.api.device.verify.$get({
        query: {
          user_code: userCode,
        },
      }),
    catch: (cause: unknown) =>
      new DeviceVerificationError({
        cause,
        message: GENERIC_DEVICE_VERIFY_ERROR_MESSAGE,
        reason: "request_failed",
      }),
  });
  if (responseResult.isErr()) {
    console.error("[device-auth] failed to verify device code", {
      errorName: readErrorName(responseResult.error.cause),
    });
    return Result.err(responseResult.error);
  }

  const response = responseResult.value;

  if (!response.ok) {
    const payload =
      await readResponseJsonOrNull<VerifyDeviceResponse>(response);
    return Result.err(
      new DeviceVerificationError({
        message: readDeviceErrorMessage(
          payload,
          GENERIC_DEVICE_VERIFY_ERROR_MESSAGE
        ),
        reason: "response_failed",
      })
    );
  }

  const payload =
    await readResponseJsonOrNull<VerifyDeviceSuccessResponse>(response);
  if (payload === null) {
    console.error("[device-auth] failed to parse verify device response");
    return Result.err(
      new DeviceVerificationError({
        message: GENERIC_DEVICE_VERIFY_ERROR_MESSAGE,
        reason: "response_failed",
      })
    );
  }

  return Result.ok({
    status: payload.status,
    userCode: payload.userCode,
  });
}

export async function submitDeviceDecisionRequest(input: {
  action: DeviceDecisionAction;
  userCode: string | null;
}): Promise<SubmitDecisionRequestResult> {
  const deviceClient = createApiClient();

  if (!input.userCode) {
    return Result.err(
      new DeviceDecisionError({
        action: input.action,
        message: GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
        reason: "missing_code",
      })
    );
  }

  const submitDecision =
    input.action === "approve"
      ? deviceClient.api.device.approve.$post
      : deviceClient.api.device.deny.$post;
  const responseResult = await Result.tryPromise({
    try: () =>
      submitDecision({
        form: {
          user_code: input.userCode,
        },
      }),
    catch: (cause: unknown) =>
      new DeviceDecisionError({
        action: input.action,
        cause,
        message: GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
        reason: "request_failed",
      }),
  });
  if (responseResult.isErr()) {
    console.error("[device-auth] failed to submit device decision", {
      action: input.action,
      errorName: readErrorName(responseResult.error.cause),
    });
    return Result.err(responseResult.error);
  }

  const response = responseResult.value;

  if (!response.ok) {
    const payload =
      await readResponseJsonOrNull<SubmitDeviceDecisionResponse>(response);
    return Result.err(
      new DeviceDecisionError({
        action: input.action,
        message: readDeviceErrorMessage(
          payload,
          GENERIC_DEVICE_DECISION_ERROR_MESSAGE
        ),
        reason: "response_failed",
      })
    );
  }

  const payload =
    await readResponseJsonOrNull<SubmitDeviceDecisionSuccessResponse>(response);
  if (payload === null) {
    console.error("[device-auth] failed to parse device decision response", {
      action: input.action,
    });
    return Result.err(
      new DeviceDecisionError({
        action: input.action,
        message: GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
        reason: "response_failed",
      })
    );
  }

  return Result.ok({
    message: payload.message,
    title: payload.title,
    tone: input.action === "approve" ? "success" : "error",
  });
}

async function readResponseJsonOrNull<T>(
  response: Response
): Promise<T | null> {
  const payloadResult = await Result.tryPromise(
    () => response.json() as Promise<T>
  );
  return payloadResult.isErr() ? null : payloadResult.value;
}

export const deviceAuthMachine = setup({
  actions: {
    resetToEntry: assign(({ context }) => resetFlowContext(context)),
    stageVerificationFromRoute: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/routeSynced");
      if (event.userCode === null) {
        return {};
      }

      return {
        inputCode: event.userCode,
        activeUserCode: event.userCode,
        alert: createIdleDeviceAuthAlert(),
        nextAsyncRequestId: context.nextAsyncRequestId + 1,
        pendingDecision: null,
        pendingVerification: {
          requestId: context.nextAsyncRequestId,
          userCode: event.userCode,
        },
        resultState: createIdleDeviceAuthResultState(),
      };
    }),
    setInputCode: assign(({ event }) => {
      assertEvent(event, "deviceAuth/inputChanged");
      return {
        inputCode: event.value,
        alert: createIdleDeviceAuthAlert(),
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
        alert: createIdleDeviceAuthAlert(),
        nextAsyncRequestId: context.nextAsyncRequestId + 1,
        pendingDecision: null,
        pendingVerification: {
          requestId: context.nextAsyncRequestId,
          userCode,
        },
        resultState: createIdleDeviceAuthResultState(),
        ...queueNavigation(context, userCode, false),
      };
    }),
    setMissingCodeError: assign({
      alert: () =>
        createDeviceAuthErrorAlert(
          "Enter the code shown in your terminal to continue."
        ),
    }),
    syncSession: assign(({ event }) => {
      assertEvent(event, "deviceAuth/sessionSynced");
      return {
        session: event.session,
        alert: createIdleDeviceAuthAlert(),
      };
    }),
    queueClearCodeNavigation: assign(({ context }) => {
      const resetContext = resetFlowContext(context);
      return {
        ...resetContext,
        ...queueNavigation(resetContext, null, false),
      };
    }),
    stageApproveDecision: assign(({ context }) => ({
      alert: createIdleDeviceAuthAlert(),
      nextAsyncRequestId: context.nextAsyncRequestId + 1,
      pendingDecision: {
        action: "approve" as const,
        requestId: context.nextAsyncRequestId,
        userCode: context.activeUserCode,
      },
    })),
    stageDenyDecision: assign(({ context }) => ({
      alert: createIdleDeviceAuthAlert(),
      nextAsyncRequestId: context.nextAsyncRequestId + 1,
      pendingDecision: {
        action: "deny" as const,
        requestId: context.nextAsyncRequestId,
        userCode: context.activeUserCode,
      },
    })),
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
        alert: createDeviceAuthErrorAlert(event.message),
      };
    }),
    storeVerificationFailure: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/verificationFailed");
      if (context.pendingVerification?.requestId !== event.requestId) {
        return {};
      }

      return {
        alert: createDeviceAuthErrorAlert(event.message),
        inputCode: context.activeUserCode ?? context.inputCode,
        pendingDecision: null,
        pendingVerification: null,
        resultState: createIdleDeviceAuthResultState(),
      };
    }),
    storeVerifiedPending: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/verificationSucceeded");
      if (context.pendingVerification?.requestId !== event.requestId) {
        return {};
      }

      return readVerifiedTransition({
        context,
        resultState: createIdleDeviceAuthResultState(),
        userCode: event.userCode,
      });
    }),
    storeVerifiedApproved: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/verificationSucceeded");
      if (context.pendingVerification?.requestId !== event.requestId) {
        return {};
      }

      return readVerifiedTransition({
        context,
        resultState: createReadyDeviceAuthResultState({
          title: "Device Approved",
          message:
            "Return to your terminal to continue. You can close this tab.",
          tone: "success",
        }),
        userCode: event.userCode,
      });
    }),
    storeVerifiedDenied: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/verificationSucceeded");
      if (context.pendingVerification?.requestId !== event.requestId) {
        return {};
      }

      return readVerifiedTransition({
        context,
        resultState: createReadyDeviceAuthResultState({
          title: "Device Denied",
          message:
            "This device code has already been denied. Start onequery auth login again if you need a new code.",
          tone: "error",
        }),
        userCode: event.userCode,
      });
    }),
    storeDecisionFailure: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/decisionFailed");
      if (context.pendingDecision?.requestId !== event.requestId) {
        return {};
      }

      return {
        alert: createDeviceAuthErrorAlert(event.message),
        inputCode: context.activeUserCode ?? "",
        pendingDecision: null,
        resultState: createIdleDeviceAuthResultState(),
      };
    }),
    storeDecisionSuccess: assign(({ context, event }) => {
      assertEvent(event, "deviceAuth/decisionSucceeded");
      if (context.pendingDecision?.requestId !== event.requestId) {
        return {};
      }

      return {
        alert: createIdleDeviceAuthAlert(),
        pendingDecision: null,
        resultState: createReadyDeviceAuthResultState({
          message: event.message,
          title: event.title,
          tone: event.tone,
        }),
      };
    }),
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
    matchesPendingVerification: ({ context, event }) =>
      event.type === "deviceAuth/verificationFailed" &&
      context.pendingVerification?.requestId === event.requestId,
    matchesPendingDecision: ({ context, event }) =>
      (event.type === "deviceAuth/decisionFailed" ||
        event.type === "deviceAuth/decisionSucceeded") &&
      context.pendingDecision?.requestId === event.requestId,
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
        actions: "stageVerificationFromRoute",
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
      on: {
        "deviceAuth/verificationFailed": {
          actions: "storeVerificationFailure",
          guard: "matchesPendingVerification",
          target: "entry",
        },
        "deviceAuth/verificationSucceeded": [
          {
            guard: ({ context, event }) =>
              event.type === "deviceAuth/verificationSucceeded" &&
              context.pendingVerification?.requestId === event.requestId &&
              event.status === "pending",
            target: "pending",
            actions: "storeVerifiedPending",
          },
          {
            guard: ({ context, event }) =>
              event.type === "deviceAuth/verificationSucceeded" &&
              context.pendingVerification?.requestId === event.requestId &&
              event.status === "approved",
            target: "result",
            actions: "storeVerifiedApproved",
          },
          {
            guard: ({ context, event }) =>
              event.type === "deviceAuth/verificationSucceeded" &&
              context.pendingVerification?.requestId === event.requestId,
            target: "result",
            actions: "storeVerifiedDenied",
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
          on: {
            "deviceAuth/decisionFailed": {
              actions: "storeDecisionFailure",
              guard: "matchesPendingDecision",
              target: "#deviceAuth.entry",
            },
            "deviceAuth/decisionSucceeded": {
              actions: "storeDecisionSuccess",
              guard: "matchesPendingDecision",
              target: "#deviceAuth.result",
            },
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

export function readDeviceAuthErrorMessage(snapshot: DeviceAuthSnapshot) {
  return snapshot.context.alert.kind === "error"
    ? snapshot.context.alert.message
    : null;
}

export function readDeviceAuthResult(snapshot: DeviceAuthSnapshot) {
  return snapshot.context.resultState.kind === "ready"
    ? snapshot.context.resultState.result
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

function readVerifiedTransition(input: {
  context: DeviceAuthContext;
  resultState: DeviceAuthResultState;
  userCode: string;
}) {
  return {
    activeUserCode: input.userCode,
    alert: createIdleDeviceAuthAlert(),
    inputCode: input.userCode,
    pendingDecision: null,
    pendingVerification: null,
    resultState: input.resultState,
    ...(shouldReplaceNavigation(input.context.activeUserCode, input.userCode)
      ? queueNavigation(input.context, input.userCode, true)
      : {
          navigation: null,
          nextNavigationId: input.context.nextNavigationId,
        }),
  };
}

function shouldReplaceNavigation(
  activeUserCode: string | null,
  userCode: string
) {
  return userCode !== activeUserCode;
}

function readErrorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}
