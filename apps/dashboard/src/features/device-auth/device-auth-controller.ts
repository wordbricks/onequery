import { useNavigate } from "@tanstack/react-router";
import { useActor } from "@xstate/react";
import { fromPromise } from "xstate";

import { buildDeviceAuthPath, DEVICE_ROUTE } from "@/lib/app-routes";

import {
  deviceAuthMachine,
  readDeviceAuthErrorMessage,
  readDeviceAuthResult,
  readNavigationErrorMessage,
  readPanelView,
  readSessionEmail,
  submitDeviceDecisionActorRequest,
  verifyDeviceActorRequest,
} from "./device-auth-machine";
import type {
  DeviceNavigationTarget,
  DevicePanelView,
  DeviceResult,
  DeviceSession,
  SubmitDeviceDecisionActorInput,
  SubmitDeviceDecisionActorOutput,
  VerifyDeviceActorInput,
  VerifyDeviceActorOutput,
} from "./device-auth-machine";
import { getPanelMeta } from "./device-auth-ui";
import type { PanelMeta } from "./device-auth-ui";

export type DeviceAuthController = {
  panelView: DevicePanelView;
  panelMeta: PanelMeta;
  inputCode: string;
  activeUserCode: string | null;
  onboardingOrganizationId: string | null;
  errorMessage: string | null;
  result: DeviceResult | null;
  sessionEmail: string | null;
  resumePath: string;
  isSubmittingApprove: boolean;
  isSubmittingDeny: boolean;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onApprove: () => void;
  onDeny: () => void;
  onUseDifferentCode: () => void;
};

export type DeviceAuthControllerInput = {
  initialSession: DeviceSession;
  onboardingOrganizationId: string | null;
  requestedUserCode: string | null;
};

export function useDeviceAuthController({
  initialSession,
  onboardingOrganizationId,
  requestedUserCode,
}: DeviceAuthControllerInput): DeviceAuthController {
  const navigate = useNavigate();
  const [state, send] = useActor(
    deviceAuthMachine.provide({
      actions: {
        navigateToDeviceRoute: (
          { self },
          target: DeviceNavigationTarget | null
        ) => {
          if (target === null) {
            return;
          }

          // Comment: keep the bootstrap orgId attached only while the device
          // code is present so URL-driven router sync stays canonical.
          navigate({
            replace: target.replace,
            search:
              target.userCode === null
                ? {}
                : {
                    user_code: target.userCode,
                    ...(onboardingOrganizationId
                      ? { orgId: onboardingOrganizationId }
                      : {}),
                  },
            to: DEVICE_ROUTE,
          })
            .then(() => {
              self.send({
                id: target.id,
                type: "deviceAuth/navigationCompleted",
              });
            })
            .catch((error: unknown) => {
              console.error("[device-auth] failed to sync device route", {
                errorName: readErrorName(error),
                navigationId: target.id,
                replace: target.replace,
              });
              self.send({
                id: target.id,
                message: readNavigationErrorMessage(error),
                type: "deviceAuth/navigationFailed",
              });
            });
        },
      },
      actors: {
        submitDeviceDecision: fromPromise<
          SubmitDeviceDecisionActorOutput,
          SubmitDeviceDecisionActorInput
        >(async ({ input, signal }) =>
          submitDeviceDecisionActorRequest(input, { signal })
        ),
        verifyDevice: fromPromise<
          VerifyDeviceActorOutput,
          VerifyDeviceActorInput
        >(async ({ input, signal }) =>
          verifyDeviceActorRequest(input, { signal })
        ),
      },
    }),
    {
      input: {
        initialSession,
        initialUserCode: requestedUserCode,
      },
    }
  );
  const panelView = readPanelView(state);
  const inputCode = state.context.inputCode;
  const activeUserCode = state.context.activeUserCode;
  const errorMessage = readDeviceAuthErrorMessage(state);
  const result = readDeviceAuthResult(state);
  const sessionEmail = readSessionEmail(state);
  const currentCode = activeUserCode ?? requestedUserCode;
  const resumePath = buildDeviceAuthPath(currentCode, onboardingOrganizationId);
  const panelMeta = getPanelMeta({ panelView, result });

  return {
    activeUserCode,
    errorMessage,
    inputCode,
    isSubmittingApprove: state.matches({ pending: "approving" }),
    isSubmittingDeny: state.matches({ pending: "denying" }),
    onboardingOrganizationId,
    onApprove: () => {
      send({ type: "deviceAuth/approve" });
    },
    onDeny: () => {
      send({ type: "deviceAuth/deny" });
    },
    onInputChange: (value) => {
      send({
        type: "deviceAuth/inputChanged",
        value: value.toUpperCase(),
      });
    },
    onSubmit: () => {
      send({ type: "deviceAuth/submit" });
    },
    onUseDifferentCode: () => {
      send({ type: "deviceAuth/useDifferentCode" });
    },
    panelMeta,
    panelView,
    result,
    resumePath,
    sessionEmail,
  };
}

function readErrorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}
