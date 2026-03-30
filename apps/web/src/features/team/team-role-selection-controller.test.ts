import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { teamRoleSelectionMachine } from "@/features/team/team-role-selection-controller";

describe("teamRoleSelectionMachine", () => {
  it("keeps assignable roles canonical while toggling and resetting", () => {
    const actor = createActor(teamRoleSelectionMachine, {
      input: {
        initialRoleNames: ["member"],
      },
    });

    actor.start();

    expect(actor.getSnapshot().context.selectedRoleNames).toEqual(["member"]);
    expect(actor.getSnapshot().context.sourceRoleNames).toEqual(["member"]);

    actor.send({
      type: "teamRoleSelection/toggleRole",
      roleName: "admin",
    });

    expect(actor.getSnapshot().context.selectedRoleNames).toEqual([
      "admin",
      "member",
    ]);

    actor.send({
      type: "teamRoleSelection/toggleRole",
      roleName: "member",
    });

    expect(actor.getSnapshot().context.selectedRoleNames).toEqual(["admin"]);

    actor.send({
      type: "teamRoleSelection/sourceRoleNamesSynced",
      roleNames: ["member", "admin", "member"],
    });

    expect(actor.getSnapshot().context.selectedRoleNames).toEqual([
      "admin",
      "member",
    ]);
    expect(actor.getSnapshot().context.sourceRoleNames).toEqual([
      "admin",
      "member",
    ]);

    actor.send({
      type: "teamRoleSelection/toggleRole",
      roleName: "member",
    });

    expect(actor.getSnapshot().context.selectedRoleNames).toEqual(["admin"]);

    actor.send({
      type: "teamRoleSelection/reset",
    });

    expect(actor.getSnapshot().context.selectedRoleNames).toEqual([
      "admin",
      "member",
    ]);
  });
});
