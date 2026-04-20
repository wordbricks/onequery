import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";

import { createContactModalMachine } from "./contact-modal.machine";

function noop() {}

describe("createContactModalMachine", () => {
  it("closes on success and resets the captured form state", async () => {
    const actor = createActor(
      createContactModalMachine({
        submitContact: async () => undefined,
        trackContactFormSubmitted: noop,
        trackContactModalOpened: noop,
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
    expect(actor.getSnapshot().context.submission).toEqual({
      kind: "idle",
    });
  });

  it("returns to editing with the previous form contents after a failed submit", async () => {
    const actor = createActor(
      createContactModalMachine({
        submitContact: async () => {
          throw new Error("Lead capture offline");
        },
        trackContactFormSubmitted: noop,
        trackContactModalOpened: noop,
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
    expect(actor.getSnapshot().context.submission).toEqual({
      kind: "submitFailed",
      message: "Lead capture offline",
    });
  });

  it("ignores telemetry failures after a successful submit", async () => {
    const actor = createActor(
      createContactModalMachine({
        submitContact: async () => undefined,
        trackContactModalOpened: noop,
        trackContactFormSubmitted: () => {
          throw new Error("analytics boom");
        },
      })
    );

    actor.start();
    actor.send({ type: "contactModal/openRequested" });
    actor.send({ type: "contactModal/submit" });

    await waitFor(actor, (snapshot) => snapshot.matches("closed"));
    await Promise.resolve();

    expect(actor.getSnapshot().matches("closed")).toBe(true);
    expect(actor.getSnapshot().context.submission).toEqual({
      kind: "idle",
    });
  });
});
