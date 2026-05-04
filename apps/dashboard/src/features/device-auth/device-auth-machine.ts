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
  requireActiveUserCode,
  resetFlowContext,
  shouldReplaceNavigation,
} from "./device-auth-model";
import type {
  DeviceActorFailure,
  DeviceAuthContext,
  DeviceAuthResultState,
  DeviceAuthTypes,
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
  verifyDeviceActorRequest,
} from "./device-auth-requests";
export { DeviceActorRequestError } from "./errors";

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
    clearDecisionAlert: assign(() => ({
      alert: createIdleDeviceAuthAlert(),
      resultState: createIdleDeviceAuthResultState(),
    })),
    storeVerified: assign(
      (
        { context },
        params: {
          output: VerifyDeviceActorOutput;
          resultState: DeviceAuthResultState;
        }
      ) =>
        readVerifiedTransition({
          context,
          resultState: params.resultState,
          userCode: params.output.userCode,
        })
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
      ({ context }, params: DeviceActorFailure) => ({
        alert: createDeviceAuthErrorAlert(params.message),
        inputCode: context.activeUserCode ?? context.inputCode,
        resultState: createIdleDeviceAuthResultState(),
      })
    ),
    storeDecisionFailure: assign(({ context }, params: DeviceActorFailure) => ({
      alert: createDeviceAuthErrorAlert(params.message),
      inputCode: context.activeUserCode ?? "",
      resultState: createIdleDeviceAuthResultState(),
    })),
    storeDecisionSuccess: assign(
      (_context, params: SubmitDeviceDecisionActorOutput) => ({
        alert: createIdleDeviceAuthAlert(),
        resultState: createReadyDeviceAuthResultState({
          message: params.message,
          title: params.title,
          tone: params.tone,
        }),
      })
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
    hasActiveUserCode: ({ context }) => context.activeUserCode !== null,
    hasSignedInActiveUserCode: ({ context }) =>
      context.activeUserCode !== null && context.session.kind === "signedIn",
    hasNormalizedInputCode: ({ context }) =>
      normalizeUserCode(context.inputCode) !== null,
    storedSessionSignedIn: ({ context }) => context.session.kind === "signedIn",
    storedSessionSignedOut: ({ context }) =>
      context.session.kind === "signedOut",
    verifiedPendingDevice: (_, output: VerifyDeviceActorOutput) =>
      output.status === "pending",
    verifiedApprovedDevice: (_, output: VerifyDeviceActorOutput) =>
      output.status === "approved",
    verifiedDeniedDevice: (_, output: VerifyDeviceActorOutput) =>
      output.status === "denied",
  },
  types: {} as DeviceAuthTypes,
});

export const deviceAuthMachine = deviceAuthMachineSetup.createMachine({
  context: ({ input }) => createInitialDeviceAuthContext(input),
  id: "deviceAuth",
  initial: "bootstrap",
  on: {
    "deviceAuth/navigationCompleted": {
      actions: "completeNavigation",
    },
    "deviceAuth/navigationFailed": {
      actions: "failNavigation",
    },
  },
  states: {
    bootstrap: {
      always: [
        {
          guard: "hasSignedInActiveUserCode",
          target: "pending",
        },
        {
          guard: "hasActiveUserCode",
          target: "verifying",
        },
        {
          target: "entry",
        },
      ],
    },
    entry: {
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
        input: ({ context }) => ({
          userCode: requireActiveUserCode(context),
        }),
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
            params: ({ event }) =>
              readActorFailure(
                event.error,
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
              target: "approving",
              actions: "clearDecisionAlert",
            },
            "deviceAuth/deny": {
              target: "denying",
              actions: "clearDecisionAlert",
            },
          },
        },
        approving: {
          invoke: {
            src: "submitDeviceDecision",
            input: ({ context }) => ({
              action: "approve",
              userCode: requireActiveUserCode(context),
            }),
            onDone: {
              actions: {
                type: "storeDecisionSuccess",
                params: ({ event }) => event.output,
              },
              target: "#deviceAuth.result",
            },
            onError: {
              actions: {
                type: "storeDecisionFailure",
                params: ({ event }) =>
                  readActorFailure(
                    event.error,
                    GENERIC_DEVICE_DECISION_ERROR_MESSAGE
                  ),
              },
              target: "#deviceAuth.entry",
            },
          },
        },
        denying: {
          invoke: {
            src: "submitDeviceDecision",
            input: ({ context }) => ({
              action: "deny",
              userCode: requireActiveUserCode(context),
            }),
            onDone: {
              actions: {
                type: "storeDecisionSuccess",
                params: ({ event }) => event.output,
              },
              target: "#deviceAuth.result",
            },
            onError: {
              actions: {
                type: "storeDecisionFailure",
                params: ({ event }) =>
                  readActorFailure(
                    event.error,
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
  fallbackMessage: string
): DeviceActorFailure {
  if (error instanceof DeviceActorRequestError) {
    return {
      message: error.message,
    };
  }

  return {
    message: fallbackMessage,
  };
}
