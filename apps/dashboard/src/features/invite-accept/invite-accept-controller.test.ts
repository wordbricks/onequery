import { describe, expect, it, vi } from "vitest";
import { createActor, fromPromise, waitFor } from "xstate";

import {
  createInviteAcceptMachine,
  readInviteAcceptErrorMessage,
  readInviteAcceptStatus,
} from "@/features/invite-accept/invite-accept-controller";
import type {
  AcceptInvitationActorInput,
  InviteAcceptRedirectTarget,
  NavigateToInviteTargetActorInput,
  ResolveRedirectActorInput,
} from "@/features/invite-accept/invite-accept-controller";

const SUCCESS_REDIRECT_DELAY_MS = 100;
const ACCEPT_ERROR_MESSAGE = "You are not the recipient of the invitation";
const NAVIGATION_ERROR_MESSAGE = "Redirect blocked";
const INVITATION_ID = "invite_123";
const ACCEPTED_ORGANIZATION_ID = "org_123";
const ORGANIZATION_REDIRECT_TARGET: InviteAcceptRedirectTarget = {
  kind: "organization",
  organizationSlug: "acme",
};
const HOME_REDIRECT_TARGET: InviteAcceptRedirectTarget = { kind: "home" };

type AcceptInvitationActorOutput = {
  acceptedOrganizationId: string;
};

function createTestMachine() {
  return createInviteAcceptMachine({
    successRedirectDelayMs: SUCCESS_REDIRECT_DELAY_MS,
  });
}

function createNeverSettlingPromise() {
  return new Promise<undefined>(() => {});
}

async function advanceTimersByTime(ms: number) {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe("createInviteAcceptMachine", () => {
  it("keeps the error presentation while navigating home after an accept failure", async () => {
    const actor = createActor(
      createTestMachine().provide({
        actors: {
          acceptInvitation: fromPromise<
            AcceptInvitationActorOutput,
            AcceptInvitationActorInput
          >(async () => {
            throw new Error(ACCEPT_ERROR_MESSAGE);
          }),
          navigateToInviteTarget: fromPromise<
            undefined,
            NavigateToInviteTargetActorInput
          >(async () => createNeverSettlingPromise()),
        },
      }),
      {
        input: {
          invitationId: INVITATION_ID,
        },
      }
    ).start();

    actor.send({ type: "inviteAccept/accept" });

    const failed = await waitFor(
      actor,
      (snapshot) => snapshot.matches("error"),
      {
        timeout: 1000,
      }
    );

    expect(readInviteAcceptStatus(failed)).toBe("error");
    expect(readInviteAcceptErrorMessage(failed)).toBe(ACCEPT_ERROR_MESSAGE);

    actor.send({ type: "inviteAccept/goHome" });

    expect(actor.getSnapshot().matches("navigating")).toBe(true);
    expect(readInviteAcceptStatus(actor.getSnapshot())).toBe("error");
    expect(readInviteAcceptErrorMessage(actor.getSnapshot())).toBe(
      ACCEPT_ERROR_MESSAGE
    );

    actor.stop();
  });

  it("stays in the ready presentation while declining to home", () => {
    const actor = createActor(
      createTestMachine().provide({
        actors: {
          navigateToInviteTarget: fromPromise<
            undefined,
            NavigateToInviteTargetActorInput
          >(async () => createNeverSettlingPromise()),
        },
      }),
      {
        input: {
          invitationId: INVITATION_ID,
        },
      }
    ).start();

    actor.send({ type: "inviteAccept/decline" });

    expect(actor.getSnapshot().matches("navigating")).toBe(true);
    expect(actor.getSnapshot().context.redirectTarget).toEqual(
      HOME_REDIRECT_TARGET
    );
    expect(readInviteAcceptStatus(actor.getSnapshot())).toBe("ready");

    actor.stop();
  });

  it("reports success only after the invitation has been accepted and redirect resolved", async () => {
    const actor = createActor(
      createTestMachine().provide({
        actors: {
          acceptInvitation: fromPromise<
            AcceptInvitationActorOutput,
            AcceptInvitationActorInput
          >(async () => ({
            acceptedOrganizationId: ACCEPTED_ORGANIZATION_ID,
          })),
          resolveRedirect: fromPromise<
            InviteAcceptRedirectTarget,
            ResolveRedirectActorInput
          >(async () => ORGANIZATION_REDIRECT_TARGET),
        },
      }),
      {
        input: {
          invitationId: INVITATION_ID,
        },
      }
    ).start();

    actor.send({ type: "inviteAccept/accept" });

    const successPendingRedirect = await waitFor(
      actor,
      (snapshot) => snapshot.matches("successPendingRedirect"),
      {
        timeout: 1000,
      }
    );

    expect(successPendingRedirect.context.outcome).toEqual({
      kind: "accepted",
      organizationId: ACCEPTED_ORGANIZATION_ID,
    });
    expect(successPendingRedirect.context.redirectTarget).toEqual(
      ORGANIZATION_REDIRECT_TARGET
    );
    expect(readInviteAcceptStatus(successPendingRedirect)).toBe("success");

    actor.stop();
  });

  it("falls back to home when redirect resolution fails after acceptance", async () => {
    const actor = createActor(
      createTestMachine().provide({
        actors: {
          acceptInvitation: fromPromise<
            AcceptInvitationActorOutput,
            AcceptInvitationActorInput
          >(async () => ({
            acceptedOrganizationId: ACCEPTED_ORGANIZATION_ID,
          })),
          resolveRedirect: fromPromise<
            InviteAcceptRedirectTarget,
            ResolveRedirectActorInput
          >(async () => {
            throw new Error("organization list lagged");
          }),
        },
      }),
      {
        input: {
          invitationId: INVITATION_ID,
        },
      }
    ).start();

    actor.send({ type: "inviteAccept/accept" });

    const successPendingRedirect = await waitFor(
      actor,
      (snapshot) => snapshot.matches("successPendingRedirect"),
      {
        timeout: 1000,
      }
    );

    expect(successPendingRedirect.context.redirectTarget).toEqual(
      HOME_REDIRECT_TARGET
    );
    expect(readInviteAcceptStatus(successPendingRedirect)).toBe("success");

    actor.stop();
  });

  it("queues navigation after the success redirect delay", async () => {
    vi.useFakeTimers();

    const navigationTargets: unknown[] = [];
    const actor = createActor(
      createTestMachine().provide({
        actors: {
          acceptInvitation: fromPromise<
            AcceptInvitationActorOutput,
            AcceptInvitationActorInput
          >(async () => ({
            acceptedOrganizationId: ACCEPTED_ORGANIZATION_ID,
          })),
          navigateToInviteTarget: fromPromise<
            undefined,
            NavigateToInviteTargetActorInput
          >(async ({ input }) => {
            navigationTargets.push(input.target);
            return createNeverSettlingPromise();
          }),
          resolveRedirect: fromPromise<
            InviteAcceptRedirectTarget,
            ResolveRedirectActorInput
          >(async () => ORGANIZATION_REDIRECT_TARGET),
        },
      }),
      {
        input: {
          invitationId: INVITATION_ID,
        },
      }
    ).start();

    actor.send({ type: "inviteAccept/accept" });

    await waitFor(actor, (snapshot) =>
      snapshot.matches("successPendingRedirect")
    );

    const navigating = waitFor(actor, (snapshot) =>
      snapshot.matches("navigating")
    );

    await advanceTimersByTime(SUCCESS_REDIRECT_DELAY_MS);
    await navigating;

    expect(readInviteAcceptStatus(actor.getSnapshot())).toBe("success");
    expect(navigationTargets).toEqual([ORGANIZATION_REDIRECT_TARGET]);

    actor.stop();
    vi.useRealTimers();
  });

  it("stores navigation failures as user-visible errors", async () => {
    const actor = createActor(
      createTestMachine().provide({
        actors: {
          navigateToInviteTarget: fromPromise<
            undefined,
            NavigateToInviteTargetActorInput
          >(async () => {
            throw new Error(NAVIGATION_ERROR_MESSAGE);
          }),
        },
      }),
      {
        input: {
          invitationId: INVITATION_ID,
        },
      }
    ).start();

    actor.send({ type: "inviteAccept/decline" });

    const failed = await waitFor(
      actor,
      (snapshot) => snapshot.matches("error"),
      {
        timeout: 1000,
      }
    );

    expect(readInviteAcceptStatus(failed)).toBe("error");
    expect(readInviteAcceptErrorMessage(failed)).toBe(NAVIGATION_ERROR_MESSAGE);

    actor.stop();
  });
});
