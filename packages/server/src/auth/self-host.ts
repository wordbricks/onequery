import { and, eq, invitation } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";

export const INVITE_ONLY_SIGNUP_MESSAGE =
  "Public signup is disabled. Ask an organization admin for an invitation before creating an account.";
const MAX_AUTH_EMAIL_LENGTH = 320;

type AuthBootstrapMode = "first-user" | "invite-only";

type AuthBootstrapState = {
  hasUsers: boolean;
  signupMode: AuthBootstrapMode;
};

type SignupAuthorization =
  | {
      allowed: true;
      reason: "bootstrap" | "pending-invitation";
      state: AuthBootstrapState;
    }
  | {
      allowed: false;
      message: string;
      state: AuthBootstrapState;
    };

export async function readAuthBootstrapState(input: {
  db: Database;
}): Promise<AuthBootstrapState> {
  const firstUser = await input.db.query.user.findFirst({
    columns: { id: true },
  });
  const hasUsers = firstUser !== undefined;

  return {
    hasUsers,
    signupMode: hasUsers ? "invite-only" : "first-user",
  };
}

export async function authorizeSelfHostSignUp(input: {
  db: Database;
  email: string;
}): Promise<SignupAuthorization> {
  const state = await readAuthBootstrapState(input);

  if (!state.hasUsers) {
    return {
      allowed: true,
      reason: "bootstrap",
      state,
    };
  }

  const normalizedEmail = normalizeAuthLookupEmail(input.email);
  if (!normalizedEmail) {
    return {
      allowed: false,
      message: INVITE_ONLY_SIGNUP_MESSAGE,
      state,
    };
  }

  const invitations = await input.db.query.invitation.findMany({
    columns: {
      expiresAt: true,
    },
    where: and(
      eq(invitation.email, normalizedEmail),
      eq(invitation.status, "pending")
    ),
  });

  const now = Date.now();
  const hasLiveInvitation = invitations.some(
    (invitation) => invitation.expiresAt.getTime() > now
  );

  if (hasLiveInvitation) {
    return {
      allowed: true,
      reason: "pending-invitation",
      state,
    };
  }

  return {
    allowed: false,
    message: INVITE_ONLY_SIGNUP_MESSAGE,
    state,
  };
}

function normalizeAuthLookupEmail(email: string): string | null {
  const normalizedEmail = email.trim().toLowerCase();

  if (
    normalizedEmail.length === 0 ||
    normalizedEmail.length > MAX_AUTH_EMAIL_LENGTH
  ) {
    return null;
  }

  return normalizedEmail;
}
