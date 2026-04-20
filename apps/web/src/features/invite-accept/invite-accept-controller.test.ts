import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import { getPathsFromEvents, getShortestPaths } from "xstate/graph";

import {
  createInviteAcceptMachine,
  readInviteAcceptErrorMessage,
  readInviteAcceptStatus,
} from "@/features/invite-accept/invite-accept-controller";

const SUCCESS_REDIRECT_DELAY_MS = 100;
const ACCEPT_ERROR_MESSAGE = "You are not the recipient of the invitation";
const NAVIGATION_ERROR_MESSAGE = "Redirect blocked";

function createTestMachine() {
  return createInviteAcceptMachine({
    successRedirectDelayMs: SUCCESS_REDIRECT_DELAY_MS,
  });
}

function buildInviteAcceptShortestPaths() {
  return getShortestPaths(createTestMachine(), {
    events: (state) => {
      if (state.matches("accepting")) {
        const pendingAcceptRequest = state.context.pendingAcceptRequest;

        if (pendingAcceptRequest === null) {
          return [];
        }

        return [
          {
            type: "inviteAccept/acceptSucceeded" as const,
            acceptedOrganizationId: "org_123",
            requestId: pendingAcceptRequest.requestId,
          },
          {
            type: "inviteAccept/acceptFailed" as const,
            message: ACCEPT_ERROR_MESSAGE,
            requestId: pendingAcceptRequest.requestId,
          },
        ];
      }

      if (state.matches("refreshingOrganizations")) {
        const pendingRedirectResolution =
          state.context.pendingRedirectResolution;

        if (pendingRedirectResolution === null) {
          return [];
        }

        return [
          {
            type: "inviteAccept/redirectResolved" as const,
            redirectTarget: {
              kind: "organization" as const,
              organizationSlug: "acme",
            },
            requestId: pendingRedirectResolution.requestId,
          },
          {
            type: "inviteAccept/redirectResolutionFailed" as const,
            requestId: pendingRedirectResolution.requestId,
          },
        ];
      }

      if (state.matches("navigating")) {
        const navigation = state.context.navigation;

        if (navigation === null) {
          return [];
        }

        return [
          {
            type: "inviteAccept/navigationStarted" as const,
            id: navigation.id,
          },
          {
            type: "inviteAccept/navigationCompleted" as const,
            id: navigation.id,
          },
          {
            type: "inviteAccept/navigationFailed" as const,
            id: navigation.id,
            message: NAVIGATION_ERROR_MESSAGE,
          },
        ];
      }

      if (state.matches("error")) {
        return [{ type: "inviteAccept/goHome" as const }];
      }

      return [
        { type: "inviteAccept/accept" as const },
        { type: "inviteAccept/decline" as const },
      ];
    },
    filterEvents: (state, event) => state.can(event),
    stopWhen: (state) =>
      state.matches("successPendingRedirect") ||
      state.matches("error") ||
      (state.matches("ready") && state.context.nextNavigationId > 1),
  });
}

function describeGraphPath(path: {
  state: { value: unknown };
  steps: Array<{ event: { type: string } }>;
}) {
  return `${JSON.stringify(path.state.value)} via ${path.steps
    .map((step) => step.event.type)
    .join(" -> ")}`;
}

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("createInviteAcceptMachine", () => {
  it("keeps the error presentation while navigating home after an accept failure", () => {
    const [path] = getPathsFromEvents(createTestMachine(), [
      {
        type: "inviteAccept/accept",
      },
      {
        type: "inviteAccept/acceptFailed",
        message: ACCEPT_ERROR_MESSAGE,
        requestId: 1,
      },
      {
        type: "inviteAccept/goHome",
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the invite failure flow");
    }

    expect(path.state.matches("navigating")).toBe(true);
    expect(readInviteAcceptStatus(path.state)).toBe("error");
    expect(readInviteAcceptErrorMessage(path.state)).toBe(ACCEPT_ERROR_MESSAGE);
  });

  it("stays in the ready presentation while declining to home", () => {
    const [path] = getPathsFromEvents(createTestMachine(), [
      {
        type: "inviteAccept/decline",
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the invite decline flow");
    }

    expect(path.state.matches("navigating")).toBe(true);
    expect(readInviteAcceptStatus(path.state)).toBe("ready");
  });

  it("reports success only after the invitation has been accepted and redirect resolved", () => {
    const [path] = getPathsFromEvents(createTestMachine(), [
      {
        type: "inviteAccept/accept",
      },
      {
        type: "inviteAccept/acceptSucceeded",
        acceptedOrganizationId: "org_123",
        requestId: 1,
      },
      {
        type: "inviteAccept/redirectResolved",
        redirectTarget: {
          kind: "organization",
          organizationSlug: "acme",
        },
        requestId: 2,
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the invite success flow");
    }

    expect(path.state.matches("successPendingRedirect")).toBe(true);
    expect(path.state.context.redirectTarget).toEqual({
      kind: "organization",
      organizationSlug: "acme",
    });
    expect(readInviteAcceptStatus(path.state)).toBe("success");
  });

  it("queues navigation after the success redirect delay", async () => {
    vi.useFakeTimers();

    const actor = createActor(createTestMachine());

    actor.start();
    actor.send({ type: "inviteAccept/accept" });
    actor.send({
      acceptedOrganizationId: "org_123",
      requestId: 1,
      type: "inviteAccept/acceptSucceeded",
    });

    const pendingRedirectResolution =
      actor.getSnapshot().context.pendingRedirectResolution;

    expect(pendingRedirectResolution).not.toBeNull();

    actor.send({
      redirectTarget: {
        kind: "organization",
        organizationSlug: "acme",
      },
      requestId: pendingRedirectResolution?.requestId ?? 0,
      type: "inviteAccept/redirectResolved",
    });

    expect(actor.getSnapshot().matches("successPendingRedirect")).toBe(true);

    await advanceTimersByTime(SUCCESS_REDIRECT_DELAY_MS);

    expect(actor.getSnapshot().matches("navigating")).toBe(true);
    expect(actor.getSnapshot().context.navigation?.target).toEqual({
      kind: "organization",
      organizationSlug: "acme",
    });

    vi.useRealTimers();
  });

  describe("graph coverage", () => {
    for (const path of buildInviteAcceptShortestPaths()) {
      it(describeGraphPath(path), () => {
        if (path.state.matches("ready")) {
          expect(path.state.context.navigation).toBeNull();
          return;
        }

        if (path.state.matches("accepting")) {
          expect(path.state.context.pendingAcceptRequest).not.toBeNull();
          return;
        }

        if (path.state.matches("refreshingOrganizations")) {
          expect(path.state.context.outcome).toEqual({
            kind: "accepted",
            organizationId: "org_123",
          });
          expect(path.state.context.pendingRedirectResolution).not.toBeNull();
          return;
        }

        if (path.state.matches("successPendingRedirect")) {
          expect(readInviteAcceptStatus(path.state)).toBe("success");
          expect(path.state.context.pendingRedirectResolution).toBeNull();
          return;
        }

        if (path.state.matches("navigating")) {
          expect(path.state.context.navigation).not.toBeNull();
          return;
        }

        expect(path.state.matches("error")).toBe(true);
        expect(readInviteAcceptStatus(path.state)).toBe("error");
        expect(readInviteAcceptErrorMessage(path.state)).not.toBeNull();
      });
    }
  });
});
