import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";

import {
  createInviteAcceptMachine,
  readInviteAcceptStatus,
} from "@/features/invite-accept/invite-accept-controller";

describe("readInviteAcceptStatus", () => {
  it("keeps the error presentation while navigating home after an accept failure", async () => {
    const actor = createActor(
      createInviteAcceptMachine({
        acceptInvitation: async () => {
          throw new Error("You are not the recipient of the invitation");
        },
        resolveRedirect: async () => ({ kind: "home" }),
      })
    );

    actor.start();
    actor.send({ type: "inviteAccept/accept" });

    await waitFor(actor, (snapshot) => snapshot.matches("error"));

    expect(readInviteAcceptStatus(actor.getSnapshot())).toBe("error");

    actor.send({ type: "inviteAccept/goHome" });

    expect(actor.getSnapshot().matches("navigating")).toBe(true);
    expect(readInviteAcceptStatus(actor.getSnapshot())).toBe("error");
  });

  it("stays in the ready presentation while declining to home", () => {
    const actor = createActor(
      createInviteAcceptMachine({
        acceptInvitation: async () => ({
          acceptedOrganizationId: "org_123",
        }),
        resolveRedirect: async () => ({ kind: "home" }),
      })
    );

    actor.start();
    actor.send({ type: "inviteAccept/decline" });

    expect(actor.getSnapshot().matches("navigating")).toBe(true);
    expect(readInviteAcceptStatus(actor.getSnapshot())).toBe("ready");
  });

  it("reports success only after the invitation has actually been accepted", async () => {
    const actor = createActor(
      createInviteAcceptMachine({
        acceptInvitation: async () => ({
          acceptedOrganizationId: "org_123",
        }),
        resolveRedirect: async () => ({ kind: "home" }),
      })
    );

    actor.start();
    actor.send({ type: "inviteAccept/accept" });

    await waitFor(actor, (snapshot) =>
      snapshot.matches("successPendingRedirect")
    );

    expect(readInviteAcceptStatus(actor.getSnapshot())).toBe("success");
  });
});
