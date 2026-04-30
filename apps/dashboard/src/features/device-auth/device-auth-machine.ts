import { assertEvent, assign, fromPromise, setup } from "xstate";

import {
  createDeviceAuthErrorAlert,
  createIdleDeviceAuthAlert,
  createIdleDeviceAuthResultState,
  createInitialDeviceAuthContext,
  createReadyDeviceAuthResultState,
  normalizeUserCode,
  queueNavigation,
  readVerifiedTransition,
  requirePendingDecision,
  requirePendingVerification,
  resetFlowContext,
  shouldReplaceNavigation,
} from "./device-auth-model";
import type {
  DeviceActorFailure,
  DeviceAuthContext,
  DeviceAuthResultState,
  DeviceAuthTypes,
  DeviceDecisionAction,
  DeviceNavigationTarget,
} from "./device-auth-model";
import type {
  SubmitDeviceDecisionActorInput,
  SubmitDeviceDecisionActorOutput,
  VerifyDeviceActorInput,
  VerifyDeviceActorOutput,
} from "./device-auth-requests";
import {
  DeviceActorRequestError,
  GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
  GENERIC_DEVICE_VERIFY_ERROR_MESSAGE,
} from "./errors";

export type {
  DeviceNavigationTarget,
  DevicePanelView,
  DeviceResult,
  DeviceSession,
} from "./device-auth-model";
export {
  readDeviceAuthErrorMessage,
  readDeviceAuthResult,
  readNavigationErrorMessage,
  readPanelView,
  readSessionEmail,
  readSessionSnapshot,
} from "./device-auth-model";
export type {
  SubmitDeviceDecisionActorInput,
  SubmitDeviceDecisionActorOutput,
  VerifyDeviceActorInput,
  VerifyDeviceActorOutput,
} from "./device-auth-requests";
export {
  submitDeviceDecisionActorRequest,
  submitDeviceDecisionRequest,
  verifyDeviceActorRequest,
  verifyDeviceRequest,
} from "./device-auth-requests";
export {
  DeviceActorRequestError,
  DeviceDecisionError,
  DeviceVerificationError,
  GENERIC_DEVICE_DECISION_ERROR_MESSAGE,
  GENERIC_DEVICE_VERIFY_ERROR_MESSAGE,
} from "./errors";

const deviceAuthMachineSetup = setup({
  actions: {
    navigateToDeviceRoute: (_, _params: DeviceNavigationTarget | null) =>
      undefined,
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
    queueClearCodeNavigation: assign(({ context }) => {
      const resetContext = resetFlowContext(context);
      return {
        ...resetContext,
        ...queueNavigation(resetContext, null, false),
      };
    }),
    stageDecision: assign(
      ({ context }, params: { action: DeviceDecisionAction }) => ({
        alert: createIdleDeviceAuthAlert(),
        nextAsyncRequestId: context.nextAsyncRequestId + 1,
        pendingDecision: {
          action: params.action,
          requestId: context.nextAsyncRequestId,
          userCode: context.activeUserCode,
        },
      })
    ),
    storeVerified: assign(
      (
        { context },
        params: {
          output: VerifyDeviceActorOutput;
          resultState: DeviceAuthResultState;
        }
      ) => {
        if (
          context.pendingVerification?.requestId !== params.output.requestId
        ) {
          return {};
        }

        return readVerifiedTransition({
          context,
          resultState: params.resultState,
          userCode: params.output.userCode,
        });
      }
    ),
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
    storeVerificationFailure: assign(
      ({ context }, params: DeviceActorFailure) => {
        if (context.pendingVerification?.requestId !== params.requestId) {
          return {};
        }

        return {
          alert: createDeviceAuthErrorAlert(params.message),
          inputCode: context.activeUserCode ?? context.inputCode,
          pendingDecision: null,
          pendingVerification: null,
          resultState: createIdleDeviceAuthResultState(),
        };
      }
    ),
    storeDecisionFailure: assign(({ context }, params: DeviceActorFailure) => {
      if (context.pendingDecision?.requestId !== params.requestId) {
        return {};
      }

      return {
        alert: createDeviceAuthErrorAlert(params.message),
        inputCode: context.activeUserCode ?? "",
        pendingDecision: null,
        resultState: createIdleDeviceAuthResultState(),
      };
    }),
    storeDecisionSuccess: assign(
      ({ context }, params: SubmitDeviceDecisionActorOutput) => {
        if (context.pendingDecision?.requestId !== params.requestId) {
          return {};
        }

        return {
          alert: createIdleDeviceAuthAlert(),
          pendingDecision: null,
          resultState: createReadyDeviceAuthResultState({
            message: params.message,
            title: params.title,
            tone: params.tone,
          }),
        };
      }
    ),
  },
  actors: {
    submitDeviceDecision: fromPromise<
      SubmitDeviceDecisionActorOutput,
      SubmitDeviceDecisionActorInput
    >(
      () =>
        new Promise<SubmitDeviceDecisionActorOutput>(() => {
          // Default actor intentionally never settles; React provides the
          // real implementation while tests provide explicit actor outcomes.
        })
    ),
    verifyDevice: fromPromise<VerifyDeviceActorOutput, VerifyDeviceActorInput>(
      () =>
        new Promise<VerifyDeviceActorOutput>(() => {
          // Default actor intentionally never settles; React provides the
          // real implementation while tests provide explicit actor outcomes.
        })
    ),
  },
  guards: {
    hasPendingVerification: ({ context }) =>
      context.pendingVerification !== null,
    hasNormalizedInputCode: ({ context }) =>
      normalizeUserCode(context.inputCode) !== null,
    storedSessionSignedIn: ({ context }) => context.session.kind === "signedIn",
    storedSessionSignedOut: ({ context }) =>
      context.session.kind === "signedOut",
    verifiedPendingDevice: ({ context }, output: VerifyDeviceActorOutput) =>
      context.pendingVerification?.requestId === output.requestId &&
      output.status === "pending",
    verifiedApprovedDevice: ({ context }, output: VerifyDeviceActorOutput) =>
      context.pendingVerification?.requestId === output.requestId &&
      output.status === "approved",
    verifiedDeniedDevice: ({ context }, output: VerifyDeviceActorOutput) =>
      context.pendingVerification?.requestId === output.requestId &&
      output.status === "denied",
    matchesPendingDecision: (
      { context },
      output: SubmitDeviceDecisionActorOutput | DeviceActorFailure
    ) => context.pendingDecision?.requestId === output.requestId,
  },
  types: {} as DeviceAuthTypes,
});

export const deviceAuthMachine = deviceAuthMachineSetup.createMachine({
  context: ({ input }) => createInitialDeviceAuthContext(input),
  id: "deviceAuth",
  initial: "entry",
  on: {
    "deviceAuth/navigationCompleted": {
      actions: "completeNavigation",
    },
    "deviceAuth/navigationFailed": {
      actions: "failNavigation",
    },
  },
  states: {
    entry: {
      always: {
        guard: "hasPendingVerification",
        target: "verifying",
      },
      on: {
        "deviceAuth/inputChanged": {
          actions: "setInputCode",
        },
        "deviceAuth/submit": [
          {
            guard: "hasNormalizedInputCode",
            target: "verifying",
            actions: [
              {
                type: "navigateToDeviceRoute",
                params: ({ context }) => {
                  const userCode = normalizeUserCode(context.inputCode);
                  return userCode === null
                    ? null
                    : {
                        id: context.nextNavigationId,
                        replace: false,
                        userCode,
                      };
                },
              },
              "stageVerificationFromInput",
            ],
          },
          {
            actions: "setMissingCodeError",
          },
        ],
      },
    },
    verifying: {
      invoke: {
        src: "verifyDevice",
        input: ({ context }) => requirePendingVerification(context),
        onDone: [
          {
            guard: {
              type: "verifiedPendingDevice",
              params: ({ event }) => event.output,
            },
            target: "pending",
            actions: [
              {
                type: "navigateToDeviceRoute",
                params: ({ context, event }) =>
                  readVerifiedNavigationTarget({
                    context,
                    output: event.output,
                  }),
              },
              {
                type: "storeVerified",
                params: ({ event }) => ({
                  output: event.output,
                  resultState: createIdleDeviceAuthResultState(),
                }),
              },
            ],
          },
          {
            guard: {
              type: "verifiedApprovedDevice",
              params: ({ event }) => event.output,
            },
            target: "result",
            actions: [
              {
                type: "navigateToDeviceRoute",
                params: ({ context, event }) =>
                  readVerifiedNavigationTarget({
                    context,
                    output: event.output,
                  }),
              },
              {
                type: "storeVerified",
                params: ({ event }) => ({
                  output: event.output,
                  resultState: createReadyDeviceAuthResultState({
                    message:
                      "Return to your terminal to continue. You can close this tab.",
                    title: "Device Approved",
                    tone: "success",
                  }),
                }),
              },
            ],
          },
          {
            guard: {
              type: "verifiedDeniedDevice",
              params: ({ event }) => event.output,
            },
            target: "result",
            actions: [
              {
                type: "navigateToDeviceRoute",
                params: ({ context, event }) =>
                  readVerifiedNavigationTarget({
                    context,
                    output: event.output,
                  }),
              },
              {
                type: "storeVerified",
                params: ({ event }) => ({
                  output: event.output,
                  resultState: createReadyDeviceAuthResultState({
                    message:
                      "This device code has already been denied. Start onequery auth login again if you need a new code.",
                    title: "Device Denied",
                    tone: "error",
                  }),
                }),
              },
            ],
          },
        ],
        onError: {
          actions: {
            type: "storeVerificationFailure",
            params: ({ context, event }) =>
              readActorFailure(
                event.error,
                context.pendingVerification?.requestId ?? 0,
                GENERIC_DEVICE_VERIFY_ERROR_MESSAGE
              ),
          },
          target: "entry",
        },
      },
    },
    pending: {
      initial: "sessionCheck",
      on: {
        "deviceAuth/useDifferentCode": {
          target: "#deviceAuth.entry",
          actions: [
            {
              type: "navigateToDeviceRoute",
              params: ({ context }) => ({
                id: context.nextNavigationId,
                replace: false,
                userCode: null,
              }),
            },
            "queueClearCodeNavigation",
          ],
        },
      },
      states: {
        sessionCheck: {
          always: [
            {
              guard: "storedSessionSignedIn",
              target: "review",
            },
            {
              guard: "storedSessionSignedOut",
              target: "signInRequired",
            },
          ],
        },
        signInRequired: {},
        review: {
          on: {
            "deviceAuth/approve": {
              target: "submittingDecision",
              actions: {
                type: "stageDecision",
                params: {
                  action: "approve",
                },
              },
            },
            "deviceAuth/deny": {
              target: "submittingDecision",
              actions: {
                type: "stageDecision",
                params: {
                  action: "deny",
                },
              },
            },
          },
        },
        submittingDecision: {
          invoke: {
            src: "submitDeviceDecision",
            input: ({ context }) => requirePendingDecision(context),
            onDone: {
              actions: {
                type: "storeDecisionSuccess",
                params: ({ event }) => event.output,
              },
              guard: {
                type: "matchesPendingDecision",
                params: ({ event }) => event.output,
              },
              target: "#deviceAuth.result",
            },
            onError: {
              actions: {
                type: "storeDecisionFailure",
                params: ({ context, event }) =>
                  readActorFailure(
                    event.error,
                    context.pendingDecision?.requestId ?? 0,
                    GENERIC_DEVICE_DECISION_ERROR_MESSAGE
                  ),
              },
              target: "#deviceAuth.entry",
            },
          },
        },
      },
    },
    result: {
      on: {
        "deviceAuth/useDifferentCode": {
          target: "entry",
          actions: [
            {
              type: "navigateToDeviceRoute",
              params: ({ context }) => ({
                id: context.nextNavigationId,
                replace: false,
                userCode: null,
              }),
            },
            "queueClearCodeNavigation",
          ],
        },
      },
    },
  },
});

function readVerifiedNavigationTarget(input: {
  context: DeviceAuthContext;
  output: VerifyDeviceActorOutput;
}): DeviceNavigationTarget | null {
  const { context, output } = input;

  if (!shouldReplaceNavigation(context.activeUserCode, output.userCode)) {
    return null;
  }

  return {
    id: context.nextNavigationId,
    replace: true,
    userCode: output.userCode,
  };
}

function readActorFailure(
  error: unknown,
  fallbackRequestId: number,
  fallbackMessage: string
): DeviceActorFailure {
  if (error instanceof DeviceActorRequestError) {
    return {
      message: error.message,
      requestId: error.requestId,
    };
  }

  return {
    message: fallbackMessage,
    requestId: fallbackRequestId,
  };
}
