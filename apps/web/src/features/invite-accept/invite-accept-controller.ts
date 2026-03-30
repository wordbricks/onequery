import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useMemo } from "react";
import { assertEvent, assign, fromPromise, setup } from "xstate";
import type { SnapshotFrom } from "xstate";

import {
  organizationsQueryOptions,
  resolveOrganizationSlug,
} from "@/features/organizations/organization-options";
import {
  INVITE_ROUTE,
  ORGANIZATION_HOME_ROUTE,
  ROOT_ROUTE,
} from "@/lib/app-routes";
import { organization } from "@/lib/auth-client";

const routeApi = getRouteApi(INVITE_ROUTE);

const DEFAULT_ACCEPT_ERROR_MESSAGE = "Failed to accept invitation";
const DEFAULT_NAVIGATION_ERROR_MESSAGE =
  "Failed to navigate. Try again from home.";
const SUCCESS_REDIRECT_DELAY_MS = 1500;
const UNCONFIGURED_ACTOR_MESSAGE = "Invite accept actor is not configured";
const HOME_REDIRECT_TARGET = { kind: "home" } as const;

const INVITE_ACCEPT_EVENT = {
  ACCEPT: "inviteAccept/accept",
  DECLINE: "inviteAccept/decline",
  GO_HOME: "inviteAccept/goHome",
  NAVIGATION_COMPLETED: "inviteAccept/navigationCompleted",
  NAVIGATION_FAILED: "inviteAccept/navigationFailed",
  NAVIGATION_STARTED: "inviteAccept/navigationStarted",
} as const;

const INVITE_ACCEPT_STATE = {
  ACCEPTING: "accepting",
  ERROR: "error",
  NAVIGATING: "navigating",
  READY: "ready",
  REFRESHING_ORGANIZATIONS: "refreshingOrganizations",
  SUCCESS_PENDING_REDIRECT: "successPendingRedirect",
} as const;

type InviteAcceptStatus = "ready" | "accepting" | "success" | "error";

type InviteAcceptRedirectTarget =
  | typeof HOME_REDIRECT_TARGET
  | {
      kind: "organization";
      organizationSlug: string;
    };

type InviteAcceptNavigation = {
  id: number;
  phase: "pending" | "running";
  target: InviteAcceptRedirectTarget;
};

type InviteAcceptContext = {
  acceptedOrganizationId: string | null;
  errorMessage: string | null;
  navigation: InviteAcceptNavigation | null;
  nextNavigationId: number;
  redirectTarget: InviteAcceptRedirectTarget | null;
};

type InviteAcceptEvent =
  | { type: typeof INVITE_ACCEPT_EVENT.ACCEPT }
  | { type: typeof INVITE_ACCEPT_EVENT.DECLINE }
  | { type: typeof INVITE_ACCEPT_EVENT.GO_HOME }
  | {
      type: typeof INVITE_ACCEPT_EVENT.NAVIGATION_STARTED;
      id: number;
    }
  | {
      type: typeof INVITE_ACCEPT_EVENT.NAVIGATION_COMPLETED;
      id: number;
    }
  | {
      type: typeof INVITE_ACCEPT_EVENT.NAVIGATION_FAILED;
      id: number;
      message: string;
    };

type InviteAcceptMachineInput = {
  acceptInvitation: () => Promise<{ acceptedOrganizationId: string }>;
  resolveRedirect: (
    acceptedOrganizationId: string
  ) => Promise<InviteAcceptRedirectTarget>;
  successRedirectDelayMs?: number;
};

type InviteAcceptTypes = {
  context: InviteAcceptContext;
  events: InviteAcceptEvent;
};

type InviteAcceptController = {
  errorMessage: string | null;
  goHome: () => void;
  accept: () => void;
  decline: () => void;
  status: InviteAcceptStatus;
};

function createInitialContext(): InviteAcceptContext {
  return {
    acceptedOrganizationId: null,
    errorMessage: null,
    navigation: null,
    nextNavigationId: 1,
    redirectTarget: null,
  };
}

function resetFlowContext(
  context: Pick<InviteAcceptContext, "nextNavigationId">
): InviteAcceptContext {
  return {
    ...createInitialContext(),
    nextNavigationId: context.nextNavigationId,
  };
}

function resetFlowWithError(
  context: Pick<InviteAcceptContext, "nextNavigationId">,
  message: string
): InviteAcceptContext {
  return {
    ...resetFlowContext(context),
    errorMessage: message,
  };
}

function queueNavigation(
  context: Pick<InviteAcceptContext, "nextNavigationId">,
  target: InviteAcceptRedirectTarget
): Pick<InviteAcceptContext, "navigation" | "nextNavigationId"> {
  return {
    navigation: {
      id: context.nextNavigationId,
      phase: "pending",
      target,
    },
    nextNavigationId: context.nextNavigationId + 1,
  };
}

function requireAcceptedOrganizationId(context: InviteAcceptContext): string {
  if (context.acceptedOrganizationId === null) {
    throw new Error("Accepted organization ID is required");
  }

  return context.acceptedOrganizationId;
}

function requireRedirectTarget(
  context: InviteAcceptContext
): InviteAcceptRedirectTarget {
  return context.redirectTarget ?? HOME_REDIRECT_TARGET;
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (message.length === 0) {
    return fallback;
  }

  return message;
}

export function createInviteAcceptMachine(input: InviteAcceptMachineInput) {
  const successRedirectDelayMs =
    input.successRedirectDelayMs ?? SUCCESS_REDIRECT_DELAY_MS;

  return setup({
    actions: {
      markNavigationRunning: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.NAVIGATION_STARTED);
        if (context.navigation?.id !== event.id) {
          return {};
        }

        return {
          navigation: {
            ...context.navigation,
            phase: "running" as const,
          },
        };
      }),
      queueHomeNavigation: assign(({ context }) =>
        queueNavigation(context, HOME_REDIRECT_TARGET)
      ),
      queueResolvedNavigation: assign(({ context }) =>
        queueNavigation(context, requireRedirectTarget(context))
      ),
      resetFlow: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.NAVIGATION_COMPLETED);
        if (context.navigation?.id !== event.id) {
          return {};
        }

        return resetFlowContext(context);
      }),
      storeAcceptError: assign({
        acceptedOrganizationId: () => null,
        errorMessage: (_, params: { message: string }) => params.message,
        navigation: () => null,
        redirectTarget: () => null,
      }),
      storeAcceptedOrganizationId: assign({
        acceptedOrganizationId: (
          _,
          params: { acceptedOrganizationId: string }
        ) => params.acceptedOrganizationId,
        errorMessage: () => null,
        redirectTarget: () => null,
      }),
      storeHomeRedirectTarget: assign({
        redirectTarget: () => HOME_REDIRECT_TARGET,
      }),
      storeNavigationError: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.NAVIGATION_FAILED);
        if (context.navigation?.id !== event.id) {
          return {};
        }

        return resetFlowWithError(context, event.message);
      }),
      storeResolvedRedirectTarget: assign({
        redirectTarget: (
          _,
          params: { redirectTarget: InviteAcceptRedirectTarget }
        ) => params.redirectTarget,
      }),
    },
    actors: {
      acceptInvitation: fromPromise<{ acceptedOrganizationId: string }>(
        async () => {
          throw new Error(UNCONFIGURED_ACTOR_MESSAGE);
        }
      ),
      resolveRedirect: fromPromise<
        InviteAcceptRedirectTarget,
        { acceptedOrganizationId: string }
      >(async () => {
        throw new Error(UNCONFIGURED_ACTOR_MESSAGE);
      }),
    },
    types: {} as InviteAcceptTypes,
  })
    .createMachine({
      context: createInitialContext(),
      id: "inviteAccept",
      initial: INVITE_ACCEPT_STATE.READY,
      states: {
        [INVITE_ACCEPT_STATE.READY]: {
          on: {
            [INVITE_ACCEPT_EVENT.ACCEPT]: INVITE_ACCEPT_STATE.ACCEPTING,
            [INVITE_ACCEPT_EVENT.DECLINE]: {
              actions: "queueHomeNavigation",
              target: INVITE_ACCEPT_STATE.NAVIGATING,
            },
          },
        },
        [INVITE_ACCEPT_STATE.ACCEPTING]: {
          invoke: {
            src: "acceptInvitation",
            onDone: {
              actions: {
                type: "storeAcceptedOrganizationId",
                params: ({ event }) => ({
                  acceptedOrganizationId: event.output.acceptedOrganizationId,
                }),
              },
              target: INVITE_ACCEPT_STATE.REFRESHING_ORGANIZATIONS,
            },
            onError: {
              actions: {
                type: "storeAcceptError",
                params: ({ event }) => ({
                  message: readErrorMessage(
                    event.error,
                    DEFAULT_ACCEPT_ERROR_MESSAGE
                  ),
                }),
              },
              target: INVITE_ACCEPT_STATE.ERROR,
            },
          },
        },
        [INVITE_ACCEPT_STATE.REFRESHING_ORGANIZATIONS]: {
          invoke: {
            src: "resolveRedirect",
            input: ({ context }) => ({
              acceptedOrganizationId: requireAcceptedOrganizationId(context),
            }),
            onDone: {
              actions: {
                type: "storeResolvedRedirectTarget",
                params: ({ event }) => ({
                  redirectTarget: event.output,
                }),
              },
              target: INVITE_ACCEPT_STATE.SUCCESS_PENDING_REDIRECT,
            },
            onError: {
              actions: "storeHomeRedirectTarget",
              target: INVITE_ACCEPT_STATE.SUCCESS_PENDING_REDIRECT,
            },
          },
        },
        [INVITE_ACCEPT_STATE.SUCCESS_PENDING_REDIRECT]: {
          after: {
            [successRedirectDelayMs]: {
              actions: "queueResolvedNavigation",
              target: INVITE_ACCEPT_STATE.NAVIGATING,
            },
          },
        },
        [INVITE_ACCEPT_STATE.NAVIGATING]: {
          on: {
            [INVITE_ACCEPT_EVENT.NAVIGATION_COMPLETED]: {
              actions: "resetFlow",
              target: INVITE_ACCEPT_STATE.READY,
            },
            [INVITE_ACCEPT_EVENT.NAVIGATION_FAILED]: {
              actions: "storeNavigationError",
              target: INVITE_ACCEPT_STATE.ERROR,
            },
            [INVITE_ACCEPT_EVENT.NAVIGATION_STARTED]: {
              actions: "markNavigationRunning",
            },
          },
        },
        [INVITE_ACCEPT_STATE.ERROR]: {
          on: {
            [INVITE_ACCEPT_EVENT.GO_HOME]: {
              actions: "queueHomeNavigation",
              target: INVITE_ACCEPT_STATE.NAVIGATING,
            },
          },
        },
      },
    })
    .provide({
      actors: {
        acceptInvitation: fromPromise(async () => input.acceptInvitation()),
        resolveRedirect: fromPromise(async ({ input: actorInput }) =>
          input.resolveRedirect(actorInput.acceptedOrganizationId)
        ),
      },
    });
}

export function readInviteAcceptStatus(
  state: SnapshotFrom<ReturnType<typeof createInviteAcceptMachine>>
): InviteAcceptStatus {
  if (state.matches(INVITE_ACCEPT_STATE.ACCEPTING)) {
    return "accepting";
  }
  if (state.matches(INVITE_ACCEPT_STATE.ERROR)) {
    return "error";
  }
  if (
    state.matches(INVITE_ACCEPT_STATE.NAVIGATING) &&
    state.context.acceptedOrganizationId === null &&
    state.context.errorMessage !== null
  ) {
    return "error";
  }
  if (
    state.matches(INVITE_ACCEPT_STATE.REFRESHING_ORGANIZATIONS) ||
    state.matches(INVITE_ACCEPT_STATE.SUCCESS_PENDING_REDIRECT) ||
    (state.matches(INVITE_ACCEPT_STATE.NAVIGATING) &&
      state.context.acceptedOrganizationId !== null)
  ) {
    return "success";
  }
  return "ready";
}

function readNavigationErrorMessage(error: unknown): string {
  return readErrorMessage(error, DEFAULT_NAVIGATION_ERROR_MESSAGE);
}

export function useInviteAcceptController(): InviteAcceptController {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { invitationId } = routeApi.useParams();
  const { auth, refetchSession } = routeApi.useRouteContext();
  const userId = auth.session?.user.id;

  const acceptInvitation = useCallback(async () => {
    const result = await organization.acceptInvitation({
      invitationId,
    });
    if (result.error) {
      throw new Error(result.error.message);
    }

    return {
      acceptedOrganizationId: result.data.member.organizationId,
    };
  }, [invitationId]);

  const resolveRedirect = useCallback(
    async (
      acceptedOrganizationId: string
    ): Promise<InviteAcceptRedirectTarget> => {
      try {
        await refetchSession();
        // Comment: invite acceptance mutates persisted membership data, so the
        // redirect should be resolved against a fresh user-scoped org list.
        const organizations = await queryClient.fetchQuery({
          ...organizationsQueryOptions(userId),
          staleTime: 0,
        });

        const acceptedOrganization = organizations.find(
          (org) => org.id === acceptedOrganizationId
        );
        if (acceptedOrganization) {
          return {
            kind: "organization",
            organizationSlug: resolveOrganizationSlug(acceptedOrganization),
          };
        }

        // Comment: Better Auth already knows the accepted organization id, so
        // fall back to an explicit org lookup before giving up to home. This
        // avoids routing users to `/` if the refreshed membership list lags.
        const fullOrganization = await organization.getFullOrganization({
          query: { organizationId: acceptedOrganizationId },
        });
        if (fullOrganization.data?.slug) {
          return {
            kind: "organization",
            organizationSlug: fullOrganization.data.slug,
          };
        }

        console.error(
          "[invite] accepted invitation but organization was not found",
          {
            acceptedOrganizationId,
            userId,
          }
        );
      } catch (error) {
        console.error(
          "[invite] accepted invitation but failed to refresh orgs",
          {
            acceptedOrganizationId,
            error,
            userId,
          }
        );
      }

      return HOME_REDIRECT_TARGET;
    },
    [queryClient, refetchSession, userId]
  );

  const machine = useMemo(
    () =>
      createInviteAcceptMachine({
        acceptInvitation,
        resolveRedirect,
      }),
    [acceptInvitation, resolveRedirect]
  );

  const [state, send] = useMachine(machine);
  const navigation = state.context.navigation;

  useEffect(() => {
    if (navigation === null || navigation.phase !== "pending") {
      return;
    }

    send({
      id: navigation.id,
      type: INVITE_ACCEPT_EVENT.NAVIGATION_STARTED,
    });

    const navigationPromise =
      navigation.target.kind === "home"
        ? navigate({ to: ROOT_ROUTE })
        : navigate({
            params: {
              org_slug: navigation.target.organizationSlug,
            },
            to: ORGANIZATION_HOME_ROUTE,
          });

    navigationPromise
      .then(() => {
        send({
          id: navigation.id,
          type: INVITE_ACCEPT_EVENT.NAVIGATION_COMPLETED,
        });
      })
      .catch((error: unknown) => {
        console.error(
          "[invite] failed to navigate after accepting invitation",
          {
            error,
            navigation,
          }
        );
        send({
          id: navigation.id,
          message: readNavigationErrorMessage(error),
          type: INVITE_ACCEPT_EVENT.NAVIGATION_FAILED,
        });
      });
  }, [navigate, navigation, send]);

  return {
    accept: () => {
      send({ type: INVITE_ACCEPT_EVENT.ACCEPT });
    },
    decline: () => {
      send({ type: INVITE_ACCEPT_EVENT.DECLINE });
    },
    errorMessage: state.context.errorMessage,
    goHome: () => {
      send({ type: INVITE_ACCEPT_EVENT.GO_HOME });
    },
    status: readInviteAcceptStatus(state),
  };
}
