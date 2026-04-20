import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";

import { createContactModalMachine } from "./contact-modal.machine";

describe("createContactModalMachine", () => {
  it("closes on success and resets the captured form state", async () => {
    const actor = createActor(
      createContactModalMachine({
        submitContact: async () => undefined,
      })
    );

    actor.start();
    actor.send({ type: "contactModal/openRequested" });
    actor.send({
      type: "contactModal/fieldChanged",
      field: "name",
      value: "Jane Doe",
    });
    actor.send({
      type: "contactModal/fieldChanged",
      field: "email",
      value: "jane@onequery.dev",
    });
    actor.send({
      type: "contactModal/fieldChanged",
      field: "message",
      value: "Need a rollout plan.",
    });
    actor.send({ type: "contactModal/submit" });

    await waitFor(actor, (snapshot) => snapshot.matches("closed"));

    expect(actor.getSnapshot().context.form).toEqual({
      email: "",
      message: "",
      name: "",
    });
    expect(actor.getSnapshot().context.successfulSubmissionCount).toBe(1);
  });

  it("returns to editing with the previous form contents after a failed submit", async () => {
    const actor = createActor(
      createContactModalMachine({
        submitContact: async () => {
          throw new Error("Lead capture offline");
        },
      })
    );

    actor.start();
    actor.send({ type: "contactModal/openRequested" });
    actor.send({
      type: "contactModal/fieldChanged",
      field: "email",
      value: "jane@onequery.dev",
    });
    actor.send({
      type: "contactModal/fieldChanged",
      field: "message",
      value: "Need a rollout plan.",
    });
    actor.send({ type: "contactModal/submit" });

    await waitFor(actor, (snapshot) => snapshot.matches({ open: "editing" }));

    expect(actor.getSnapshot().context.form.email).toBe("jane@onequery.dev");
    expect(actor.getSnapshot().context.form.message).toBe(
      "Need a rollout plan."
    );
    expect(actor.getSnapshot().context.errorMessage).toBe(
      "Lead capture offline"
    );
  });
});
