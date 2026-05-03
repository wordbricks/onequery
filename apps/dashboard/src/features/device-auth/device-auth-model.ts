import { normalizeDeviceUserCode } from "@onequery/base/device-auth";

export type DeviceResultTone = "success" | "error";

export type DeviceResult = {
  title: string;
  message: string;
  tone: DeviceResultTone;
};

export type DeviceSession =
  | { kind: "pending" }
  | { kind: "signedOut" }
  | { kind: "signedIn"; email: string };

export type DeviceDecisionAction = "approve" | "deny";

export type DeviceNavigation = {
  id: number;
  userCode: string | null;
  replace: boolean;
};

export type DeviceVerificationRequest = {
  userCode: string;
};

export type DeviceDecisionRequest = {
  action: DeviceDecisionAction;
  userCode: string;
};

export type DeviceNavigationTarget = {
  id: number;
  replace: boolean;
  userCode: string | null;
};

export type DeviceAuthAlert =
  | { kind: "idle" }
  | {
      kind: "error";
      message: string;
    };

export type DeviceAuthResultState =
  | { kind: "idle" }
  | {
      kind: "ready";
      result: DeviceResult;
    };

export type DeviceAuthContext = {
  inputCode: string;
  activeUserCode: string | null;
  alert: DeviceAuthAlert;
  resultState: DeviceAuthResultState;
  session: DeviceSession;
  navigation: DeviceNavigation | null;
  nextNavigationId: number;
};

export type DeviceAuthMachineInput = {
  initialSession: DeviceSession;
  initialUserCode: string | null;
};

export type DeviceAuthEvent =
  | { type: "deviceAuth/inputChanged"; value: string }
  | { type: "deviceAuth/submit" }
  | { type: "deviceAuth/navigationCompleted"; id: number }
  | { type: "deviceAuth/navigationFailed"; id: number; message: string }
  | { type: "deviceAuth/approve" }
  | { type: "deviceAuth/deny" }
  | { type: "deviceAuth/useDifferentCode" };

export type DeviceAuthTypes = {
  context: DeviceAuthContext;
  events: DeviceAuthEvent;
  input: DeviceAuthMachineInput | undefined;
};

export type DevicePanelView =
  | "entry"
  | "verifying"
  | "sessionCheck"
  | "signInRequired"
  | "review"
  | "result";

export type DeviceActorFailure = {
  message: string;
};

export type DeviceAuthReadableSnapshot = {
  context: DeviceAuthContext;
  value:
    | "bootstrap"
    | "entry"
    | "verifying"
    | "result"
    | {
        pending:
          | "sessionCheck"
          | "signInRequired"
          | "review"
          | "approving"
          | "denying";
      };
};

export function createIdleDeviceAuthAlert(): DeviceAuthAlert {
  return {
    kind: "idle",
  };
}

export function createDeviceAuthErrorAlert(message: string): DeviceAuthAlert {
  return {
    kind: "error",
    message,
  };
}

export function createIdleDeviceAuthResultState(): DeviceAuthResultState {
  return {
    kind: "idle",
  };
}

export function createReadyDeviceAuthResultState(
  result: DeviceResult
): DeviceAuthResultState {
  return {
    kind: "ready",
    result,
  };
}

export function createInitialDeviceAuthContext(
  input?: DeviceAuthMachineInput
): DeviceAuthContext {
  const context = {
    activeUserCode: null,
    alert: createIdleDeviceAuthAlert(),
    inputCode: "",
    navigation: null,
    nextNavigationId: 1,
    resultState: createIdleDeviceAuthResultState(),
    session: input?.initialSession ?? { kind: "pending" },
  };

  if (!input?.initialUserCode) {
    return context;
  }

  return {
    ...context,
    activeUserCode: input.initialUserCode,
    inputCode: input.initialUserCode,
  };
}

export function resetFlowContext(
  context: Pick<DeviceAuthContext, "nextNavigationId" | "session">
): DeviceAuthContext {
  return {
    ...createInitialDeviceAuthContext(),
    nextNavigationId: context.nextNavigationId,
    session: context.session,
  };
}

export function queueNavigation(
  context: Pick<DeviceAuthContext, "nextNavigationId">,
  userCode: string | null,
  replace: boolean
): Pick<DeviceAuthContext, "navigation" | "nextNavigationId"> {
  return {
    navigation: {
      id: context.nextNavigationId,
      replace,
      userCode,
    },
    nextNavigationId: context.nextNavigationId + 1,
  };
}

export function normalizeUserCode(value: string | null) {
  return normalizeDeviceUserCode(value) ?? null;
}

export function readPanelView(
  snapshot: DeviceAuthReadableSnapshot
): DevicePanelView {
  if (snapshot.value === "bootstrap") {
    return "entry";
  }
  if (snapshot.value === "entry") {
    return "entry";
  }
  if (snapshot.value === "verifying") {
    return "verifying";
  }
  if (snapshot.value === "result") {
    return "result";
  }

  if (snapshot.value.pending === "sessionCheck") {
    return "sessionCheck";
  }
  if (snapshot.value.pending === "signInRequired") {
    return "signInRequired";
  }
  return "review";
}

export function readSessionEmail(snapshot: DeviceAuthReadableSnapshot) {
  return snapshot.context.session.kind === "signedIn"
    ? snapshot.context.session.email
    : null;
}

export function readDeviceAuthErrorMessage(
  snapshot: DeviceAuthReadableSnapshot
) {
  return snapshot.context.alert.kind === "error"
    ? snapshot.context.alert.message
    : null;
}

export function readDeviceAuthResult(snapshot: DeviceAuthReadableSnapshot) {
  return snapshot.context.resultState.kind === "ready"
    ? snapshot.context.resultState.result
    : null;
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

export function readVerifiedTransition(input: {
  context: DeviceAuthContext;
  resultState: DeviceAuthResultState;
  userCode: string;
}) {
  return {
    activeUserCode: input.userCode,
    alert: createIdleDeviceAuthAlert(),
    inputCode: input.userCode,
    resultState: input.resultState,
    ...(shouldReplaceNavigation(input.context.activeUserCode, input.userCode)
      ? queueNavigation(input.context, input.userCode, true)
      : {}),
  };
}

export function shouldReplaceNavigation(
  activeUserCode: string | null,
  userCode: string
) {
  return userCode !== activeUserCode;
}

export function requireActiveUserCode(context: DeviceAuthContext): string {
  if (context.activeUserCode === null) {
    throw new Error("Active user code is required in device request states");
  }

  return context.activeUserCode;
}
