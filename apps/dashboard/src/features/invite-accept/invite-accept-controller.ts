import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMachine } from "@xstate/react";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { useCallback, useEffect } from "react";
import { assertEvent, assign, setup } from "xstate";
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
const HOME_REDIRECT_TARGET = { kind: "home" } as const;

const INVITE_ACCEPT_EVENT = {
  ACCEPT: "inviteAccept/accept",
  ACCEPT_FAILED: "inviteAccept/acceptFailed",
  ACCEPT_SUCCEEDED: "inviteAccept/acceptSucceeded",
  DECLINE: "inviteAccept/decline",
  GO_HOME: "inviteAccept/goHome",
  NAVIGATION_COMPLETED: "inviteAccept/navigationCompleted",
  NAVIGATION_FAILED: "inviteAccept/navigationFailed",
  NAVIGATION_STARTED: "inviteAccept/navigationStarted",
  REDIRECT_RESOLUTION_FAILED: "inviteAccept/redirectResolutionFailed",
  REDIRECT_RESOLVED: "inviteAccept/redirectResolved",
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

type InviteAcceptOutcome =
  | { kind: "idle" }
  | {
      kind: "accepted";
      organizationId: string;
    }
  | {
      kind: "error";
      message: string;
    };

type PendingInviteAcceptRequest = {
  requestId: number;
};

type PendingRedirectResolution = {
  acceptedOrganizationId: string;
  requestId: number;
};

type InviteAcceptContext = {
  navigation: InviteAcceptNavigation | null;
  nextNavigationId: number;
  nextRequestId: number;
  outcome: InviteAcceptOutcome;
  pendingAcceptRequest: PendingInviteAcceptRequest | null;
  pendingRedirectResolution: PendingRedirectResolution | null;
  redirectTarget: InviteAcceptRedirectTarget | null;
};

type InviteAcceptEvent =
  | { type: typeof INVITE_ACCEPT_EVENT.ACCEPT }
  | {
      type: typeof INVITE_ACCEPT_EVENT.ACCEPT_FAILED;
      message: string;
      requestId: number;
    }
  | {
      type: typeof INVITE_ACCEPT_EVENT.ACCEPT_SUCCEEDED;
      acceptedOrganizationId: string;
      requestId: number;
    }
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
    }
  | {
      type: typeof INVITE_ACCEPT_EVENT.REDIRECT_RESOLUTION_FAILED;
      requestId: number;
    }
  | {
      type: typeof INVITE_ACCEPT_EVENT.REDIRECT_RESOLVED;
      redirectTarget: InviteAcceptRedirectTarget;
      requestId: number;
    };

type InviteAcceptMachineOptions = {
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

class InviteAcceptRequestError extends TaggedError("InviteAcceptRequestError")<{
  cause?: unknown;
  message: string;
  reason: "request_failed" | "response_failed";
}>() {}

class InviteRedirectResolutionError extends TaggedError(
  "InviteRedirectResolutionError"
)<{
  acceptedOrganizationId: string;
  cause?: unknown;
  message: string;
  reason:
    | "organization_list_failed"
    | "organization_lookup_failed"
    | "organization_missing"
    | "session_refresh_failed";
  userId?: string;
}>() {}

type InviteAcceptRequestResult = ResultType<
  {
    acceptedOrganizationId: string;
  },
  InviteAcceptRequestError
>;

type InviteRedirectResolutionResult = ResultType<
  InviteAcceptRedirectTarget,
  InviteRedirectResolutionError
>;

function createIdleInviteAcceptOutcome(): InviteAcceptOutcome {
  return {
    kind: "idle",
  };
}

function createAcceptedInviteAcceptOutcome(
  organizationId: string
): InviteAcceptOutcome {
  return {
    kind: "accepted",
    organizationId,
  };
}

function createInviteAcceptErrorOutcome(message: string): InviteAcceptOutcome {
  return {
    kind: "error",
    message,
  };
}

function createInitialContext(): InviteAcceptContext {
  return {
    navigation: null,
    nextNavigationId: 1,
    nextRequestId: 1,
    outcome: createIdleInviteAcceptOutcome(),
    pendingAcceptRequest: null,
    pendingRedirectResolution: null,
    redirectTarget: null,
  };
}

function resetFlowContext(
  context: Pick<InviteAcceptContext, "nextNavigationId" | "nextRequestId">
): InviteAcceptContext {
  return {
    ...createInitialContext(),
    nextNavigationId: context.nextNavigationId,
    nextRequestId: context.nextRequestId,
  };
}

function resetFlowWithError(
  context: Pick<InviteAcceptContext, "nextNavigationId" | "nextRequestId">,
  message: string
): InviteAcceptContext {
  return {
    ...resetFlowContext(context),
    outcome: createInviteAcceptErrorOutcome(message),
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

function requireRedirectTarget(
  context: InviteAcceptContext
): InviteAcceptRedirectTarget {
  return context.redirectTarget ?? HOME_REDIRECT_TARGET;
}

async function acceptInvitationRequest(
  invitationId: string
): Promise<InviteAcceptRequestResult> {
  const responseResult = await Result.tryPromise({
    try: () =>
      organization.acceptInvitation({
        invitationId,
      }),
    catch: (cause: unknown) =>
      new InviteAcceptRequestError({
        cause,
        message: DEFAULT_ACCEPT_ERROR_MESSAGE,
        reason: "request_failed",
      }),
  });
  if (responseResult.isErr()) {
    return Result.err(responseResult.error);
  }

  const response = responseResult.value;
  if (response.error) {
    return Result.err(
      new InviteAcceptRequestError({
        message: readMessageText(
          response.error.message,
          DEFAULT_ACCEPT_ERROR_MESSAGE
        ),
        reason: "response_failed",
      })
    );
  }

  return Result.ok({
    acceptedOrganizationId: response.data.member.organizationId,
  });
}

async function resolveInviteRedirect(input: {
  acceptedOrganizationId: string;
  queryClient: QueryClient;
  refetchSession: () => Promise<unknown>;
  userId: string | undefined;
}): Promise<InviteRedirectResolutionResult> {
  const sessionRefreshResult = await Result.tryPromise({
    try: () => input.refetchSession(),
    catch: (cause: unknown) =>
      new InviteRedirectResolutionError({
        acceptedOrganizationId: input.acceptedOrganizationId,
        cause,
        message: "Failed to refresh organizations after accepting invitation",
        reason: "session_refresh_failed",
        ...(input.userId ? { userId: input.userId } : {}),
      }),
  });
  if (sessionRefreshResult.isErr()) {
    logInviteRedirectResolutionError(sessionRefreshResult.error);
    return Result.err(sessionRefreshResult.error);
  }

  const organizationsResult = await Result.tryPromise({
    try: () =>
      input.queryClient.fetchQuery({
        ...organizationsQueryOptions(input.userId),
        staleTime: 0,
      }),
    catch: (cause: unknown) =>
      new InviteRedirectResolutionError({
        acceptedOrganizationId: input.acceptedOrganizationId,
        cause,
        message: "Failed to refresh organizations after accepting invitation",
        reason: "organization_list_failed",
        ...(input.userId ? { userId: input.userId } : {}),
      }),
  });
  if (organizationsResult.isErr()) {
    logInviteRedirectResolutionError(organizationsResult.error);
    return Result.err(organizationsResult.error);
  }

  const acceptedOrganization = organizationsResult.value.find(
    (organization: { id: string }) =>
      organization.id === input.acceptedOrganizationId
  );
  if (acceptedOrganization) {
    return Result.ok({
      kind: "organization",
      organizationSlug: resolveOrganizationSlug(acceptedOrganization),
    });
  }

  const fullOrganizationResult = await Result.tryPromise({
    try: () =>
      organization.getFullOrganization({
        query: {
          organizationId: input.acceptedOrganizationId,
        },
      }),
    catch: (cause: unknown) =>
      new InviteRedirectResolutionError({
        acceptedOrganizationId: input.acceptedOrganizationId,
        cause,
        message: "Failed to load accepted organization details",
        reason: "organization_lookup_failed",
        ...(input.userId ? { userId: input.userId } : {}),
      }),
  });
  if (fullOrganizationResult.isErr()) {
    logInviteRedirectResolutionError(fullOrganizationResult.error);
    return Result.err(fullOrganizationResult.error);
  }

  if (fullOrganizationResult.value.data?.slug) {
    return Result.ok({
      kind: "organization",
      organizationSlug: fullOrganizationResult.value.data.slug,
    });
  }

  const error = new InviteRedirectResolutionError({
    acceptedOrganizationId: input.acceptedOrganizationId,
    message: "Accepted invitation but organization was not found",
    reason: "organization_missing",
    ...(input.userId ? { userId: input.userId } : {}),
  });
  logInviteRedirectResolutionError(error);
  return Result.err(error);
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

function readMessageText(message: string | null | undefined, fallback: string) {
  const trimmedMessage = message?.trim() ?? "";
  return trimmedMessage.length > 0 ? trimmedMessage : fallback;
}

function logInviteRedirectResolutionError(
  error: InviteRedirectResolutionError
) {
  if (error.reason === "organization_missing") {
    console.error(
      "[invite] accepted invitation but organization was not found",
      {
        acceptedOrganizationId: error.acceptedOrganizationId,
        userId: error.userId,
      }
    );
    return;
  }

  console.error("[invite] accepted invitation but failed to refresh orgs", {
    acceptedOrganizationId: error.acceptedOrganizationId,
    error: error.cause ?? error.message,
    reason: error.reason,
    userId: error.userId,
  });
}

export function createInviteAcceptMachine(
  options: InviteAcceptMachineOptions = {}
) {
  const successRedirectDelayMs =
    options.successRedirectDelayMs ?? SUCCESS_REDIRECT_DELAY_MS;

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
      stageAcceptRequest: assign(({ context }) => ({
        nextRequestId: context.nextRequestId + 1,
        outcome: createIdleInviteAcceptOutcome(),
        pendingAcceptRequest: {
          requestId: context.nextRequestId,
        },
        redirectTarget: null,
      })),
      stageRedirectResolution: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.ACCEPT_SUCCEEDED);
        if (context.pendingAcceptRequest?.requestId !== event.requestId) {
          return {};
        }

        return {
          nextRequestId: context.nextRequestId + 1,
          pendingAcceptRequest: null,
          pendingRedirectResolution: {
            acceptedOrganizationId: event.acceptedOrganizationId,
            requestId: context.nextRequestId,
          },
        };
      }),
      storeAcceptError: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.ACCEPT_FAILED);
        if (context.pendingAcceptRequest?.requestId !== event.requestId) {
          return {};
        }

        return resetFlowWithError(context, event.message);
      }),
      storeAcceptedOrganizationId: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.ACCEPT_SUCCEEDED);
        if (context.pendingAcceptRequest?.requestId !== event.requestId) {
          return {};
        }

        return {
          outcome: createAcceptedInviteAcceptOutcome(
            event.acceptedOrganizationId
          ),
          redirectTarget: null,
        };
      }),
      storeHomeRedirectTarget: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.REDIRECT_RESOLUTION_FAILED);
        if (context.pendingRedirectResolution?.requestId !== event.requestId) {
          return {};
        }

        return {
          pendingRedirectResolution: null,
          redirectTarget: HOME_REDIRECT_TARGET,
        };
      }),
      storeNavigationError: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.NAVIGATION_FAILED);
        if (context.navigation?.id !== event.id) {
          return {};
        }

        return resetFlowWithError(context, event.message);
      }),
      storeResolvedRedirectTarget: assign(({ context, event }) => {
        assertEvent(event, INVITE_ACCEPT_EVENT.REDIRECT_RESOLVED);
        if (context.pendingRedirectResolution?.requestId !== event.requestId) {
          return {};
        }

        return {
          pendingRedirectResolution: null,
          redirectTarget: event.redirectTarget,
        };
      }),
    },
    guards: {
      matchesPendingAcceptRequest: ({ context, event }) => {
        if (
          event.type !== INVITE_ACCEPT_EVENT.ACCEPT_FAILED &&
          event.type !== INVITE_ACCEPT_EVENT.ACCEPT_SUCCEEDED
        ) {
          return false;
        }

        return context.pendingAcceptRequest?.requestId === event.requestId;
      },
      matchesPendingRedirectResolution: ({ context, event }) => {
        if (
          event.type !== INVITE_ACCEPT_EVENT.REDIRECT_RESOLUTION_FAILED &&
          event.type !== INVITE_ACCEPT_EVENT.REDIRECT_RESOLVED
        ) {
          return false;
        }

        return context.pendingRedirectResolution?.requestId === event.requestId;
      },
    },
    types: {} as InviteAcceptTypes,
  }).createMachine({
    context: createInitialContext(),
    id: "inviteAccept",
    initial: INVITE_ACCEPT_STATE.READY,
    states: {
      [INVITE_ACCEPT_STATE.READY]: {
        on: {
          [INVITE_ACCEPT_EVENT.ACCEPT]: {
            actions: "stageAcceptRequest",
            target: INVITE_ACCEPT_STATE.ACCEPTING,
          },
          [INVITE_ACCEPT_EVENT.DECLINE]: {
            actions: "queueHomeNavigation",
            target: INVITE_ACCEPT_STATE.NAVIGATING,
          },
        },
      },
      [INVITE_ACCEPT_STATE.ACCEPTING]: {
        on: {
          [INVITE_ACCEPT_EVENT.ACCEPT_SUCCEEDED]: {
            actions: ["storeAcceptedOrganizationId", "stageRedirectResolution"],
            guard: "matchesPendingAcceptRequest",
            target: INVITE_ACCEPT_STATE.REFRESHING_ORGANIZATIONS,
          },
          [INVITE_ACCEPT_EVENT.ACCEPT_FAILED]: {
            actions: "storeAcceptError",
            guard: "matchesPendingAcceptRequest",
            target: INVITE_ACCEPT_STATE.ERROR,
          },
        },
      },
      [INVITE_ACCEPT_STATE.REFRESHING_ORGANIZATIONS]: {
        on: {
          [INVITE_ACCEPT_EVENT.REDIRECT_RESOLVED]: {
            actions: "storeResolvedRedirectTarget",
            guard: "matchesPendingRedirectResolution",
            target: INVITE_ACCEPT_STATE.SUCCESS_PENDING_REDIRECT,
          },
          [INVITE_ACCEPT_EVENT.REDIRECT_RESOLUTION_FAILED]: {
            actions: "storeHomeRedirectTarget",
            guard: "matchesPendingRedirectResolution",
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
  });
}

export const inviteAcceptMachine = createInviteAcceptMachine();

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
    state.context.outcome.kind === "error"
  ) {
    return "error";
  }
  if (
    state.matches(INVITE_ACCEPT_STATE.REFRESHING_ORGANIZATIONS) ||
    state.matches(INVITE_ACCEPT_STATE.SUCCESS_PENDING_REDIRECT) ||
    (state.matches(INVITE_ACCEPT_STATE.NAVIGATING) &&
      state.context.outcome.kind === "accepted")
  ) {
    return "success";
  }
  return "ready";
}

export function readInviteAcceptErrorMessage(
  state: SnapshotFrom<ReturnType<typeof createInviteAcceptMachine>>
) {
  return state.context.outcome.kind === "error"
    ? state.context.outcome.message
    : null;
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

  const acceptInvitation = useCallback(
    () => acceptInvitationRequest(invitationId),
    [invitationId]
  );

  // Comment: invite acceptance mutates persisted membership data, so the
  // redirect should be resolved against a fresh user-scoped org list.
  // Comment: Better Auth already knows the accepted organization id, so fall
  // back to an explicit org lookup before redirecting home when the refreshed
  // membership list still lags.
  const resolveRedirect = useCallback(
    (acceptedOrganizationId: string): Promise<InviteRedirectResolutionResult> =>
      resolveInviteRedirect({
        acceptedOrganizationId,
        queryClient,
        refetchSession,
        userId,
      }),
    [queryClient, refetchSession, userId]
  );

  const [state, send] = useMachine(inviteAcceptMachine);
  const navigation = state.context.navigation;
  const pendingAcceptRequest = state.context.pendingAcceptRequest;
  const pendingRedirectResolution = state.context.pendingRedirectResolution;
  const isAccepting = state.matches(INVITE_ACCEPT_STATE.ACCEPTING);
  const isRefreshingOrganizations = state.matches(
    INVITE_ACCEPT_STATE.REFRESHING_ORGANIZATIONS
  );

  useEffect(() => {
    if (!isAccepting || pendingAcceptRequest === null) {
      return;
    }

    let isCancelled = false;

    void acceptInvitation().then((result) => {
      if (isCancelled) {
        return;
      }

      if (result.isErr()) {
        send({
          message: result.error.message,
          requestId: pendingAcceptRequest.requestId,
          type: INVITE_ACCEPT_EVENT.ACCEPT_FAILED,
        });
        return;
      }

      send({
        acceptedOrganizationId: result.value.acceptedOrganizationId,
        requestId: pendingAcceptRequest.requestId,
        type: INVITE_ACCEPT_EVENT.ACCEPT_SUCCEEDED,
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [acceptInvitation, isAccepting, pendingAcceptRequest, send]);

  useEffect(() => {
    if (!isRefreshingOrganizations || pendingRedirectResolution === null) {
      return;
    }

    let isCancelled = false;

    void resolveRedirect(pendingRedirectResolution.acceptedOrganizationId).then(
      (result) => {
        if (isCancelled) {
          return;
        }

        if (result.isErr()) {
          send({
            requestId: pendingRedirectResolution.requestId,
            type: INVITE_ACCEPT_EVENT.REDIRECT_RESOLUTION_FAILED,
          });
          return;
        }

        send({
          redirectTarget: result.value,
          requestId: pendingRedirectResolution.requestId,
          type: INVITE_ACCEPT_EVENT.REDIRECT_RESOLVED,
        });
      }
    );

    return () => {
      isCancelled = true;
    };
  }, [
    isRefreshingOrganizations,
    pendingRedirectResolution,
    resolveRedirect,
    send,
  ]);

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
    errorMessage: readInviteAcceptErrorMessage(state),
    goHome: () => {
      send({ type: INVITE_ACCEPT_EVENT.GO_HOME });
    },
    status: readInviteAcceptStatus(state),
  };
}
