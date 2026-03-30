import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useActorRef, useSelector } from "@xstate/react";
import { useEffect } from "react";

import { buildDeviceAuthPath, DEVICE_ROUTE } from "@/lib/app-routes";

import {
  deviceAuthMachine,
  readNavigationErrorMessage,
  readPanelView,
  readSessionEmail,
  readSessionSnapshot,
} from "./device-auth-machine";
import type { DevicePanelView, DeviceResult } from "./device-auth-machine";
import { normalizeDeviceUserCode } from "./device-auth-schema";
import { getPanelMeta } from "./device-auth-ui";
import type { PanelMeta } from "./device-auth-ui";

const routeApi = getRouteApi(DEVICE_ROUTE);

export type DeviceAuthController = {
  panelView: DevicePanelView;
  panelMeta: PanelMeta;
  inputCode: string;
  activeUserCode: string | null;
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

export function useDeviceAuthController(): DeviceAuthController {
  const navigate = useNavigate();
  const { user_code } = routeApi.useSearch();
  const { auth } = routeApi.useRouteContext();
  const requestedUserCode = normalizeDeviceUserCode(user_code ?? null) ?? null;
  const actorRef = useActorRef(deviceAuthMachine);
  const panelView = useSelector(actorRef, readPanelView);
  const inputCode = useSelector(
    actorRef,
    (snapshot) => snapshot.context.inputCode
  );
  const activeUserCode = useSelector(
    actorRef,
    (snapshot) => snapshot.context.activeUserCode
  );
  const errorMessage = useSelector(
    actorRef,
    (snapshot) => snapshot.context.error
  );
  const result = useSelector(actorRef, (snapshot) => snapshot.context.result);
  const sessionEmail = useSelector(actorRef, readSessionEmail);
  const navigation = useSelector(
    actorRef,
    (snapshot) => snapshot.context.navigation
  );
  const decisionAction = useSelector(
    actorRef,
    (snapshot) => snapshot.context.decisionAction
  );
  const isPendingFlow = useSelector(actorRef, (snapshot) =>
    snapshot.matches("pending")
  );
  const isSubmittingDecision = useSelector(actorRef, (snapshot) =>
    snapshot.matches({ pending: "submittingDecision" })
  );
  const currentCode = activeUserCode ?? requestedUserCode;
  const resumePath = buildDeviceAuthPath(currentCode);
  const panelMeta = getPanelMeta({ panelView, result });

  useEffect(() => {
    actorRef.send({
      type: "deviceAuth/routeSynced",
      userCode: requestedUserCode,
    });
  }, [actorRef, requestedUserCode]);

  useEffect(() => {
    if (!isPendingFlow) {
      return;
    }

    // Comment: App bootstrap already waits for the initial Better Auth read,
    // so device auth can consume a settled session snapshot from router context.
    actorRef.send({
      session: readSessionSnapshot({
        isSessionPending: false,
        email: auth.session?.user.email ?? null,
      }),
      type: "deviceAuth/sessionSynced",
    });
  }, [actorRef, auth.session?.user.email, isPendingFlow]);

  useEffect(() => {
    if (navigation === null || navigation.phase !== "pending") {
      return;
    }

    actorRef.send({
      id: navigation.id,
      type: "deviceAuth/navigationStarted",
    });

    // Comment: TanStack navigation only exists in React, so the machine
    // models completion/failure while this effect remains the bridge.
    navigate({
      replace: navigation.replace,
      search:
        navigation.userCode === null ? {} : { user_code: navigation.userCode },
      to: DEVICE_ROUTE,
    })
      .then(() => {
        actorRef.send({
          id: navigation.id,
          type: "deviceAuth/navigationCompleted",
        });
      })
      .catch((error: unknown) => {
        console.error("[device-auth] failed to sync device route", {
          errorName: readErrorName(error),
          navigationId: navigation.id,
          replace: navigation.replace,
        });
        actorRef.send({
          id: navigation.id,
          message: readNavigationErrorMessage(error),
          type: "deviceAuth/navigationFailed",
        });
      });
  }, [actorRef, navigate, navigation]);

  return {
    activeUserCode,
    errorMessage,
    inputCode,
    isSubmittingApprove: isSubmittingDecision && decisionAction === "approve",
    isSubmittingDeny: isSubmittingDecision && decisionAction === "deny",
    onApprove: () => {
      actorRef.send({ type: "deviceAuth/approve" });
    },
    onDeny: () => {
      actorRef.send({ type: "deviceAuth/deny" });
    },
    onInputChange: (value) => {
      actorRef.send({
        type: "deviceAuth/inputChanged",
        value: value.toUpperCase(),
      });
    },
    onSubmit: () => {
      actorRef.send({ type: "deviceAuth/submit" });
    },
    onUseDifferentCode: () => {
      actorRef.send({ type: "deviceAuth/useDifferentCode" });
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
