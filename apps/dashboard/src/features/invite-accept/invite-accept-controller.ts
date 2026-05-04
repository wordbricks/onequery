import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useActor } from "@xstate/react";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { assign, fromPromise, setup } from "xstate";
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

export const inviteAcceptRouteApi = getRouteApi(INVITE_ROUTE);

const DEFAULT_ACCEPT_ERROR_MESSAGE = "Failed to accept invitation";
const DEFAULT_NAVIGATION_ERROR_MESSAGE =
  "Failed to navigate. Try again from home.";
const SUCCESS_REDIRECT_DELAY_MS = 1500;
const HOME_REDIRECT_TARGET = { kind: "home" } as const;

const INVITE_ACCEPT_EVENT = {
  ACCEPT: "inviteAccept/accept",
  DECLINE: "inviteAccept/decline",
  GO_HOME: "inviteAccept/goHome",
} as const;

const INVITE_ACCEPT_STATE = {
  ACCEPTING: "accepting",
  ERROR: "error",
  NAVIGATING: "navigating",
  NAVIGATING_FROM_ERROR: "fromError",
  NAVIGATING_FROM_READY: "fromReady",
  NAVIGATING_FROM_SUCCESS: "fromSuccess",
  READY: "ready",
  REFRESHING_ORGANIZATIONS: "refreshingOrganizations",
  SUCCESS_PENDING_REDIRECT: "successPendingRedirect",
} as const;

const INVITE_ACCEPT_TAG = {
  ACCEPTING: "accepting",
  ERROR: "error",
  READY: "ready",
  SUCCESS: "success",
} as const;

type InviteAcceptStatus = "ready" | "accepting" | "success" | "error";

export type InviteAcceptRedirectTarget =
  | typeof HOME_REDIRECT_TARGET
  | {
      kind: "organization";
      organizationSlug: string;
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

type InviteAcceptContext = {
  invitationId: string;
  outcome: InviteAcceptOutcome;
  redirectTarget: InviteAcceptRedirectTarget | null;
};

type InviteAcceptEvent =
  | { type: typeof INVITE_ACCEPT_EVENT.ACCEPT }
  | { type: typeof INVITE_ACCEPT_EVENT.DECLINE }
  | { type: typeof INVITE_ACCEPT_EVENT.GO_HOME };

type InviteAcceptMachineInput = {
  invitationId: string;
};

type InviteAcceptMachineOptions = {
  successRedirectDelayMs?: number;
};

type InviteAcceptTypes = {
  context: InviteAcceptContext;
  events: InviteAcceptEvent;
  input: InviteAcceptMachineInput;
};

export type AcceptInvitationActorInput = {
  invitationId: string;
};

export type ResolveRedirectActorInput = {
  acceptedOrganizationId: string;
};

export type NavigateToInviteTargetActorInput = {
  target: InviteAcceptRedirectTarget;
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

function createInitialContext(invitationId: string): InviteAcceptContext {
  return {
    invitationId,
    outcome: createIdleInviteAcceptOutcome(),
    redirectTarget: null,
  };
}

function resetFlowContext(context: Pick<InviteAcceptContext, "invitationId">) {
  return createInitialContext(context.invitationId);
}

function resetFlowWithError(
  context: Pick<InviteAcceptContext, "invitationId">,
  message: string
): InviteAcceptContext {
  return {
    ...resetFlowContext(context),
    outcome: createInviteAcceptErrorOutcome(message),
  };
}

function requireRedirectTarget(
  context: InviteAcceptContext
): InviteAcceptRedirectTarget {
  return context.redirectTarget ?? HOME_REDIRECT_TARGET;
}

function requireAcceptedOrganizationId(context: InviteAcceptContext): string {
  if (context.outcome.kind !== "accepted") {
    throw new Error("Accepted organization id is required to resolve redirect");
  }

  return context.outcome.organizationId;
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
  return inviteAcceptMachineLogic.provide({
    delays: {
      successRedirect:
        options.successRedirectDelayMs ?? SUCCESS_REDIRECT_DELAY_MS,
    },
  });
}

const inviteAcceptMachineLogic = setup({
  actions: {
    prepareAcceptRequest: assign(() => ({
      outcome: createIdleInviteAcceptOutcome(),
      redirectTarget: null,
    })),
    resetFlow: assign(({ context }) => resetFlowContext(context)),
    setHomeRedirectTarget: assign({
      redirectTarget: () => HOME_REDIRECT_TARGET,
    }),
    storeAcceptError: assign(({ context }, params: { error: unknown }) =>
      resetFlowWithError(
        context,
        readErrorMessage(params.error, DEFAULT_ACCEPT_ERROR_MESSAGE)
      )
    ),
    storeAcceptedOrganizationId: assign({
      outcome: (_, params: { acceptedOrganizationId: string }) =>
        createAcceptedInviteAcceptOutcome(params.acceptedOrganizationId),
      redirectTarget: () => null,
    }),
    storeNavigationError: assign(({ context }, params: { error: unknown }) =>
      resetFlowWithError(context, readNavigationErrorMessage(params.error))
    ),
    storeResolvedRedirectTarget: assign({
      redirectTarget: (
        _,
        params: { redirectTarget: InviteAcceptRedirectTarget }
      ) => params.redirectTarget,
    }),
  },
  actors: {
    acceptInvitation: fromPromise<
      { acceptedOrganizationId: string },
      AcceptInvitationActorInput
    >(async ({ input }: { input: AcceptInvitationActorInput }) => {
      const result = await acceptInvitationRequest(input.invitationId);

      if (result.isErr()) {
        throw result.error;
      }

      return result.value;
    }),
    navigateToInviteTarget: fromPromise<
      undefined,
      NavigateToInviteTargetActorInput
    >(async (_: { input: NavigateToInviteTargetActorInput }) => undefined),
    resolveRedirect: fromPromise<
      InviteAcceptRedirectTarget,
      ResolveRedirectActorInput
    >(async (_: { input: ResolveRedirectActorInput }) => HOME_REDIRECT_TARGET),
  },
  delays: {
    successRedirect: SUCCESS_REDIRECT_DELAY_MS,
  },
  types: {} as InviteAcceptTypes,
}).createMachine({
  context: ({ input }) => createInitialContext(input.invitationId),
  id: "inviteAccept",
  initial: INVITE_ACCEPT_STATE.READY,
  states: {
    [INVITE_ACCEPT_STATE.READY]: {
      tags: INVITE_ACCEPT_TAG.READY,
      on: {
        [INVITE_ACCEPT_EVENT.ACCEPT]: {
          actions: "prepareAcceptRequest",
          target: INVITE_ACCEPT_STATE.ACCEPTING,
        },
        [INVITE_ACCEPT_EVENT.DECLINE]: {
          actions: "setHomeRedirectTarget",
          target: `${INVITE_ACCEPT_STATE.NAVIGATING}.${INVITE_ACCEPT_STATE.NAVIGATING_FROM_READY}`,
        },
      },
    },
    [INVITE_ACCEPT_STATE.ACCEPTING]: {
      tags: INVITE_ACCEPT_TAG.ACCEPTING,
      invoke: {
        src: "acceptInvitation",
        input: ({ context }) => ({
          invitationId: context.invitationId,
        }),
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
              error: event.error,
            }),
          },
          target: INVITE_ACCEPT_STATE.ERROR,
        },
      },
    },
    [INVITE_ACCEPT_STATE.REFRESHING_ORGANIZATIONS]: {
      tags: INVITE_ACCEPT_TAG.SUCCESS,
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
          actions: "setHomeRedirectTarget",
          target: INVITE_ACCEPT_STATE.SUCCESS_PENDING_REDIRECT,
        },
      },
    },
    [INVITE_ACCEPT_STATE.SUCCESS_PENDING_REDIRECT]: {
      tags: INVITE_ACCEPT_TAG.SUCCESS,
      after: {
        successRedirect: `${INVITE_ACCEPT_STATE.NAVIGATING}.${INVITE_ACCEPT_STATE.NAVIGATING_FROM_SUCCESS}`,
      },
    },
    [INVITE_ACCEPT_STATE.NAVIGATING]: {
      initial: INVITE_ACCEPT_STATE.NAVIGATING_FROM_READY,
      invoke: {
        src: "navigateToInviteTarget",
        input: ({ context }) => ({
          target: requireRedirectTarget(context),
        }),
        onDone: {
          actions: "resetFlow",
          target: INVITE_ACCEPT_STATE.READY,
        },
        onError: {
          actions: {
            type: "storeNavigationError",
            params: ({ event }) => ({
              error: event.error,
            }),
          },
          target: INVITE_ACCEPT_STATE.ERROR,
        },
      },
      states: {
        [INVITE_ACCEPT_STATE.NAVIGATING_FROM_ERROR]: {
          tags: INVITE_ACCEPT_TAG.ERROR,
        },
        [INVITE_ACCEPT_STATE.NAVIGATING_FROM_READY]: {
          tags: INVITE_ACCEPT_TAG.READY,
        },
        [INVITE_ACCEPT_STATE.NAVIGATING_FROM_SUCCESS]: {
          tags: INVITE_ACCEPT_TAG.SUCCESS,
        },
      },
    },
    [INVITE_ACCEPT_STATE.ERROR]: {
      tags: INVITE_ACCEPT_TAG.ERROR,
      on: {
        [INVITE_ACCEPT_EVENT.GO_HOME]: {
          actions: "setHomeRedirectTarget",
          target: `${INVITE_ACCEPT_STATE.NAVIGATING}.${INVITE_ACCEPT_STATE.NAVIGATING_FROM_ERROR}`,
        },
      },
    },
  },
});

const inviteAcceptMachine = createInviteAcceptMachine();

export function readInviteAcceptStatus(
  state: SnapshotFrom<ReturnType<typeof createInviteAcceptMachine>>
): InviteAcceptStatus {
  if (state.hasTag(INVITE_ACCEPT_TAG.ACCEPTING)) {
    return "accepting";
  }
  if (state.hasTag(INVITE_ACCEPT_TAG.ERROR)) {
    return "error";
  }
  if (state.hasTag(INVITE_ACCEPT_TAG.SUCCESS)) {
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
  const { invitationId } = inviteAcceptRouteApi.useParams();
  const { auth, refetchSession } = inviteAcceptRouteApi.useRouteContext();
  const userId = auth.session?.user.id;

  // Comment: invite acceptance mutates persisted membership data, so the
  // redirect should be resolved against a fresh user-scoped org list.
  // Comment: Better Auth already knows the accepted organization id, so fall
  // back to an explicit org lookup before redirecting home when the refreshed
  // membership list still lags.
  const [state, send] = useActor(
    inviteAcceptMachine.provide({
      actors: {
        navigateToInviteTarget: fromPromise<
          undefined,
          NavigateToInviteTargetActorInput
        >(async ({ input }: { input: NavigateToInviteTargetActorInput }) => {
          try {
            if (input.target.kind === "home") {
              await navigate({ to: ROOT_ROUTE });
              return undefined;
            }

            await navigate({
              params: {
                org_slug: input.target.organizationSlug,
              },
              to: ORGANIZATION_HOME_ROUTE,
            });
          } catch (error: unknown) {
            console.error(
              "[invite] failed to navigate after accepting invitation",
              {
                error,
                navigationTarget: input.target,
              }
            );
            throw new Error(readNavigationErrorMessage(error), {
              cause: error,
            });
          }
        }),
        resolveRedirect: fromPromise<
          InviteAcceptRedirectTarget,
          ResolveRedirectActorInput
        >(async ({ input }: { input: ResolveRedirectActorInput }) => {
          const result = await resolveInviteRedirect({
            acceptedOrganizationId: input.acceptedOrganizationId,
            queryClient,
            refetchSession,
            userId,
          });

          if (result.isErr()) {
            throw result.error;
          }

          return result.value;
        }),
      },
    }),
    {
      input: {
        invitationId,
      },
    }
  );

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
