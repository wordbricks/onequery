import { normalizeDeviceUserCode } from "@onequery/base/device-auth";
import { getRouteApi } from "@tanstack/react-router";

import { DEVICE_ROUTE } from "@/lib/app-routes";

import { useDeviceAuthController } from "./device-auth-controller";
import { readSessionSnapshot } from './device-auth-machine';
import type { DeviceSession } from './device-auth-machine';
import { DeviceAuthView } from "./device-auth-view";

const routeApi = getRouteApi(DEVICE_ROUTE);

export function DeviceAuthFeature() {
  const { orgId, user_code } = routeApi.useSearch();
  const { auth } = routeApi.useRouteContext();
  const onboardingOrganizationId = orgId ?? null;
  const requestedUserCode = normalizeDeviceUserCode(user_code ?? null) ?? null;
  const initialSession = readSessionSnapshot({
    email: auth.session?.user.email ?? null,
    isSessionPending: false,
  });
  const actorKey = readDeviceAuthActorKey({
    requestedUserCode,
    session: initialSession,
  });

  return (
    <DeviceAuthActorOwner
      key={actorKey}
      initialSession={initialSession}
      onboardingOrganizationId={onboardingOrganizationId}
      requestedUserCode={requestedUserCode}
    />
  );
}

function DeviceAuthActorOwner(input: {
  initialSession: DeviceSession;
  onboardingOrganizationId: string | null;
  requestedUserCode: string | null;
}) {
  const controller = useDeviceAuthController(input);

  return <DeviceAuthView controller={controller} />;
}

function readDeviceAuthActorKey(input: {
  requestedUserCode: string | null;
  session: DeviceSession;
}) {
  if (input.session.kind === "signedIn") {
    return `${input.requestedUserCode ?? ""}:signedIn:${input.session.email}`;
  }

  return `${input.requestedUserCode ?? ""}:${input.session.kind}`;
}
