import { describe, expect, it } from "vitest";
import { getPathsFromEvents, getShortestPaths } from "xstate/graph";

import { createContactModalMachine } from "./contact-modal.machine";

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

      if (state.matches({ open: "submitting" })) {
        const pendingSubmission = state.context.pendingSubmission;

        if (pendingSubmission === null) {
          return [];
        }

        return [
          {
            type: "contactModal/submitSucceeded" as const,
            requestId: pendingSubmission.requestId,
          },
          {
            type: "contactModal/submitFailed" as const,
            message: FAILURE_MESSAGE,
            requestId: pendingSubmission.requestId,
          },
        ];
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
    stopWhen: (state) =>
      (state.matches("closed") && state.context.nextSubmissionRequestId > 1) ||
      state.context.submission.kind === "submitFailed",
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

describe("createContactModalMachine", () => {
  it("closes on success and resets the captured form state", () => {
    const [path] = getPathsFromEvents(createContactModalMachine(), [
      {
        type: "contactModal/openRequested",
      },
      {
        type: "contactModal/fieldChanged",
        field: "name",
        value: CONTACT_FORM.name,
      },
      {
        type: "contactModal/fieldChanged",
        field: "email",
        value: CONTACT_FORM.email,
      },
      {
        type: "contactModal/fieldChanged",
        field: "message",
        value: CONTACT_FORM.message,
      },
      {
        type: "contactModal/submit",
      },
      {
        type: "contactModal/submitSucceeded",
        requestId: 1,
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the contact success flow");
    }

    expect(path.state.matches("closed")).toBe(true);
    expect(path.state.context.form).toEqual({
      email: "",
      message: "",
      name: "",
    });
    expect(path.state.context.submission).toEqual({
      kind: "idle",
    });
  });

  it("returns to editing with the previous form contents after a failed submit", () => {
    const [path] = getPathsFromEvents(createContactModalMachine(), [
      {
        type: "contactModal/openRequested",
      },
      {
        type: "contactModal/fieldChanged",
        field: "name",
        value: CONTACT_FORM.name,
      },
      {
        type: "contactModal/fieldChanged",
        field: "email",
        value: CONTACT_FORM.email,
      },
      {
        type: "contactModal/fieldChanged",
        field: "message",
        value: CONTACT_FORM.message,
      },
      {
        type: "contactModal/submit",
      },
      {
        type: "contactModal/submitFailed",
        message: FAILURE_MESSAGE,
        requestId: 1,
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the contact failure flow");
    }

    expect(path.state.matches({ open: "editing" })).toBe(true);
    expect(path.state.context.form).toEqual(CONTACT_FORM);
    expect(path.state.context.submission).toEqual({
      kind: "submitFailed",
      message: FAILURE_MESSAGE,
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
          expect(path.state.context.pendingSubmission).toBeNull();
          expect(path.state.context.submission).toEqual({
            kind: "idle",
          });
          return;
        }

        if (path.state.matches({ open: "submitting" })) {
          expect(path.state.context.pendingSubmission).toEqual({
            form: CONTACT_FORM,
            requestId: 1,
          });
          expect(path.state.context.submission).toEqual({
            kind: "idle",
          });
          return;
        }

        expect(path.state.matches({ open: "editing" })).toBe(true);
        expect(path.state.context.pendingSubmission).toBeNull();

        if (path.state.context.submission.kind === "submitFailed") {
          expect(path.state.context.form).toEqual(CONTACT_FORM);
          expect(path.state.context.submission).toEqual({
            kind: "submitFailed",
            message: FAILURE_MESSAGE,
          });
          return;
        }

        expect(path.state.context.submission).toEqual({
          kind: "idle",
        });
      });
    }
  });
});
