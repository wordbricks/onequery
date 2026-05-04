import { describe, expect, it } from "vitest";
import { createActor, fromPromise, waitFor } from "xstate";
import { getShortestPaths } from "xstate/graph";

import { createContactModalMachine } from "./contact-modal.machine";
import type { ContactModalSubmissionInput } from "./contact-modal.machine";

const CONTACT_FORM = {
  email: "jane@onequery.dev",
  message: "Need a rollout plan.",
  name: "Jane Doe",
} as const;
const FAILURE_MESSAGE = "Lead capture offline";

function buildContactModalShortestPaths() {
  return getShortestPaths(createContactModalMachine(), {
    events: (state) => {
      if (state.matches("closed")) {
        return [{ type: "contactModal/openRequested" as const }];
      }

      if (state.matches({ open: "editing" })) {
        if (state.context.form.name === "") {
          return [
            {
              type: "contactModal/fieldChanged" as const,
              field: "name" as const,
              value: CONTACT_FORM.name,
            },
          ];
        }

        if (state.context.form.email === "") {
          return [
            {
              type: "contactModal/fieldChanged" as const,
              field: "email" as const,
              value: CONTACT_FORM.email,
            },
          ];
        }

        if (state.context.form.message === "") {
          return [
            {
              type: "contactModal/fieldChanged" as const,
              field: "message" as const,
              value: CONTACT_FORM.message,
            },
          ];
        }

        return [{ type: "contactModal/submit" as const }];
      }

      return [];
    },
    filterEvents: (state, event) => state.can(event),
    stopWhen: (state) => state.matches({ open: "submitting" }),
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

function fillContactForm(actor: ReturnType<typeof createActor>) {
  actor.send({
    type: "contactModal/fieldChanged",
    field: "name",
    value: CONTACT_FORM.name,
  });
  actor.send({
    type: "contactModal/fieldChanged",
    field: "email",
    value: CONTACT_FORM.email,
  });
  actor.send({
    type: "contactModal/fieldChanged",
    field: "message",
    value: CONTACT_FORM.message,
  });
}

describe("createContactModalMachine", () => {
  it("closes on success and resets the captured form state", async () => {
    const actor = createActor(createContactModalMachine());

    actor.start();
    actor.send({
      type: "contactModal/openRequested",
    });
    fillContactForm(actor);
    actor.send({
      type: "contactModal/submit",
    });

    const closed = await waitFor(actor, (snapshot) =>
      snapshot.matches("closed")
    );

    expect(closed.context.form).toEqual({
      email: "",
      message: "",
      name: "",
    });
    expect(closed.context.submission).toEqual({
      kind: "idle",
    });
  });

  it("returns to editing with the previous form contents after a failed submit", async () => {
    const actor = createActor(
      createContactModalMachine().provide({
        actors: {
          submitContact: fromPromise<void, ContactModalSubmissionInput>(
            async () => {
              throw new Error(FAILURE_MESSAGE);
            }
          ),
        },
      })
    );

    actor.start();
    actor.send({
      type: "contactModal/openRequested",
    });
    fillContactForm(actor);
    actor.send({
      type: "contactModal/submit",
    });

    const editing = await waitFor(actor, (snapshot) =>
      snapshot.matches({ open: "editing" })
    );

    expect(editing.context.form).toEqual(CONTACT_FORM);
    expect(editing.context.submission).toEqual({
      kind: "submitFailed",
      message: FAILURE_MESSAGE,
    });
  });

  it("aborts the active submit actor when the modal closes", async () => {
    let abortCount = 0;
    let resolveSubmitStarted!: () => void;
    const submitStarted = new Promise<void>((resolve) => {
      resolveSubmitStarted = resolve;
    });
    const actor = createActor(
      createContactModalMachine().provide({
        actors: {
          submitContact: fromPromise<void, ContactModalSubmissionInput>(
            async ({ signal }) => {
              signal.addEventListener(
                "abort",
                () => {
                  abortCount += 1;
                },
                { once: true }
              );
              resolveSubmitStarted();

              await new Promise(() => {});
            }
          ),
        },
      })
    );

    actor.start();
    actor.send({
      type: "contactModal/openRequested",
    });
    fillContactForm(actor);
    actor.send({
      type: "contactModal/submit",
    });

    await submitStarted;
    actor.send({
      type: "contactModal/closeRequested",
    });

    const closed = await waitFor(actor, (snapshot) =>
      snapshot.matches("closed")
    );

    expect(abortCount).toBe(1);
    expect(closed.context.form).toEqual({
      email: "",
      message: "",
      name: "",
    });
  });

  describe("graph coverage", () => {
    for (const path of buildContactModalShortestPaths()) {
      it(describeGraphPath(path), () => {
        if (path.state.matches("closed")) {
          expect(path.state.context.form).toEqual({
            email: "",
            message: "",
            name: "",
          });
          expect(path.state.context.submission).toEqual({
            kind: "idle",
          });
          return;
        }

        if (path.state.matches({ open: "submitting" })) {
          expect(path.state.context.form).toEqual(CONTACT_FORM);
          expect(path.state.context.submission).toEqual({
            kind: "idle",
          });
          return;
        }

        expect(path.state.matches({ open: "editing" })).toBe(true);
        expect(path.state.context.submission).toEqual({
          kind: "idle",
        });
      });
    }
  });
});
