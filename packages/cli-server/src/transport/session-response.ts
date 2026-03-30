import type { CliAuthSessionResponse } from "../../generated/cli.schemas";
import type {
  CliAuthSessionRefreshResult,
  CliAuthWhoAmIResult,
  CliSessionIdentity,
} from "../domain/workflows";
import { toCliAuthUserView } from "../domain/workflows";
import { throwCliProblem } from "../error";
import type { CliFieldsReadControls } from "../read-controls";

type CliAuthSessionProjectedUser = NonNullable<CliAuthSessionResponse["user"]>;

export function requireCliSessionIdentity(
  session: CliSessionIdentity | null
): CliSessionIdentity {
  if (session) {
    return session;
  }

  throwCliProblem({
    detail: "no authenticated session was found",
    key: "NOT_LOGGED_IN",
  });
}

export function buildCliAuthWhoAmIResult(
  session: CliSessionIdentity
): CliAuthWhoAmIResult {
  return {
    authMode: session.authMode,
    user: toCliAuthUserView(session.user),
    activeOrgSlug: session.activeOrg,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  };
}

export function buildCliAuthSessionRefreshResult(
  session: CliSessionIdentity
): CliAuthSessionRefreshResult {
  return {
    accessToken: session.accessToken,
    ...buildCliAuthWhoAmIResult(session),
  };
}

export function projectCliSessionResponse(
  response: CliAuthWhoAmIResult,
  selectedFields: CliFieldsReadControls["selectedFields"]
): CliAuthSessionResponse {
  const requestedFields = selectedFields;
  if (!requestedFields) {
    return response;
  }

  const projected: CliAuthSessionResponse = {};
  const projectedUser = projectCliSessionUser(response.user, requestedFields);

  if (requestedFields.has("authMode")) {
    projected.authMode = response.authMode;
  }

  if (projectedUser) {
    projected.user = projectedUser;
  }

  if (requestedFields.has("activeOrgSlug")) {
    projected.activeOrgSlug = response.activeOrgSlug;
  }

  if (requestedFields.has("issuedAt")) {
    projected.issuedAt = response.issuedAt;
  }

  if (requestedFields.has("expiresAt")) {
    projected.expiresAt = response.expiresAt;
  }

  return projected;
}

function projectCliSessionUser(
  user: CliAuthWhoAmIResult["user"],
  selectedFields: Exclude<CliFieldsReadControls["selectedFields"], null>
): CliAuthSessionProjectedUser | undefined {
  if (selectedFields.has("user")) {
    return user;
  }

  const projected: CliAuthSessionProjectedUser = {};

  if (selectedFields.has("user.id")) {
    projected.id = user.id;
  }

  if (selectedFields.has("user.email")) {
    projected.email = user.email;
  }

  if (selectedFields.has("user.displayName")) {
    projected.displayName = user.displayName;
  }

  return Object.keys(projected).length > 0 ? projected : undefined;
}
