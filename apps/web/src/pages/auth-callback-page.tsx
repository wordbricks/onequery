import { getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { organizationsQueryOptions } from "@/features/organizations/organization-options";
import {
  executePostAuthRedirect,
  parseAuthRedirectPath,
} from "@/lib/auth-redirect";
import { resolvePostAuthLandingTarget } from "@/lib/post-auth-landing";
import { authBootstrapStateQueryOptions } from "@/queries/auth-bootstrap-query";
import { pendingUserInvitationsQueryOptions } from "@/queries/organization-invitation-queries";

const routeApi = getRouteApi("/auth/callback");
const INVITE_ONLY_PENDING_ACCESS_MESSAGE =
  "Your account is signed in, but you do not have access to an organization yet. Ask an admin to send or resend your invitation link.";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const hasTriedRefetch = useRef(false);
  const [refetchAttempt, setRefetchAttempt] = useState(0);
  const [statusMessage, setStatusMessage] = useState(
    "Setting up your account..."
  );
  const { redirect } = routeApi.useSearch();
  const { auth, queryClient, refetchSession } = routeApi.useRouteContext();
  const redirectTarget = parseAuthRedirectPath(redirect);

  useEffect(() => {
    let isMounted = true;

    async function handleCallback() {
      try {
        const currentAuth = auth;

        // Comment: sign-up can complete before the browser observes the new
        // session cookie. Retry the shared auth source once before declaring the
        // callback unauthenticated.
        if (!currentAuth.session?.user) {
          if (!hasTriedRefetch.current) {
            console.warn("[auth] callback missing session, retrying refetch");
            hasTriedRefetch.current = true;
            await refetchSession();
            if (isMounted) {
              setRefetchAttempt((attempt) => attempt + 1);
            }
            return;
          }

          if (!currentAuth.session?.user) {
            console.error("[auth] callback failed: session is still missing");
            if (isMounted) {
              await navigate({ to: "/signin" });
            }
            return;
          }
        }

        // Comment: preserved redirects should only resume after the router has
        // recomputed auth context from the refreshed Better Auth session.
        await router.invalidate({ sync: true });
        if (isMounted) {
          setStatusMessage("Setting up your account...");
        }

        if (!isMounted) {
          return;
        }

        if (redirectTarget && redirectTarget.path !== "/auth/callback") {
          await executePostAuthRedirect(redirectTarget, {
            navigateDocument: async (options) => navigate(options),
            navigateTo: async (to) => navigate({ to }),
          });
          return;
        }

        const userId = currentAuth.session?.user.id;
        if (!userId) {
          console.error(
            "[auth] callback failed: authenticated user is missing"
          );
          if (isMounted) {
            await navigate({ to: "/signin" });
          }
          return;
        }

        const organizations = await queryClient
          .fetchQuery({
            ...organizationsQueryOptions(userId),
            staleTime: 0,
          })
          .catch((error) => {
            console.error("[auth] callback failed to load organizations", {
              error,
            });
            return null;
          });

        if (!organizations) {
          if (isMounted) {
            await navigate({ to: "/signin" });
          }
          return;
        }

        // Guard against state updates after unmount
        if (!isMounted) {
          return;
        }

        const pendingInvitations =
          organizations.length === 0
            ? await queryClient
                .fetchQuery({
                  ...pendingUserInvitationsQueryOptions(userId),
                  staleTime: 0,
                })
                .catch((error) => {
                  console.error(
                    "[auth] callback failed to load pending invitations",
                    {
                      error,
                    }
                  );
                  return [];
                })
            : [];
        const bootstrapState = await queryClient
          .fetchQuery({
            ...authBootstrapStateQueryOptions(),
            staleTime: 0,
          })
          .catch((error) => {
            console.error("[auth] callback failed to load bootstrap state", {
              error,
            });
            return null;
          });

        const landingTarget = resolvePostAuthLandingTarget({
          organizations,
          pendingInvitations,
          signupMode: bootstrapState?.signupMode,
        });

        if (landingTarget.kind === "organizationHome") {
          // TODO: Check if org has agents
          // Later we'll check: if no agents -> /onboarding/create-agent
          await navigate({
            params: { org_slug: landingTarget.organizationSlug },
            to: "/$org_slug/home",
          });
          return;
        }

        if (landingTarget.kind === "invite") {
          await navigate({
            params: { invitationId: landingTarget.invitationId },
            to: "/invite/$invitationId",
          });
          return;
        }

        if (landingTarget.kind === "inviteOnlyPendingAccess") {
          console.warn(
            "[auth] callback found no organizations or pending invitations in invite-only mode"
          );
          if (isMounted) {
            setStatusMessage(INVITE_ONLY_PENDING_ACCESS_MESSAGE);
          }
          return;
        }

        console.warn(
          "[auth] callback found no organizations or pending invitations, onboarding redirect"
        );
        await navigate({ to: "/onboarding/create-org" });
      } catch (error) {
        console.error("[auth] callback failed unexpectedly", {
          error,
        });
        if (isMounted) {
          await navigate({ to: "/signin" });
        }
      }
    }

    void handleCallback();

    return () => {
      isMounted = false;
    };
  }, [
    auth.session?.user.id,
    navigate,
    queryClient,
    redirectTarget,
    refetchAttempt,
    refetchSession,
    router,
  ]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="max-w-md text-center text-muted-foreground">
        {statusMessage}
      </div>
    </div>
  );
}
