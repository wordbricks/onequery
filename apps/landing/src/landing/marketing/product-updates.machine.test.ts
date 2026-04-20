import { describe, expect, it } from "vitest";
import { getPathsFromEvents, getShortestPaths } from "xstate/graph";

import { createProductUpdatesMachine } from "./product-updates.machine";

const RAW_EMAIL = "TEAM@ONEQUERY.dev ";
const NORMALIZED_EMAIL = "team@onequery.dev";
const FAILURE_MESSAGE = "Webhook unavailable";

function buildProductUpdatesShortestPaths() {
  return getShortestPaths(createProductUpdatesMachine(), {
    events: (state) => {
      if (state.matches("submitting")) {
        const pendingSubmission = state.context.pendingSubmission;

        if (pendingSubmission === null) {
          return [];
        }

        return [
          {
            type: "productUpdates/submissionSucceeded" as const,
            email: pendingSubmission.email.trim().toLowerCase(),
            requestId: pendingSubmission.requestId,
          },
          {
            type: "productUpdates/submissionFailed" as const,
            message: FAILURE_MESSAGE,
            requestId: pendingSubmission.requestId,
          },
        ];
      }

      if (state.context.email === "") {
        return [
          {
            type: "productUpdates/emailChanged" as const,
            email: RAW_EMAIL,
          },
        ];
      }

      return [
        {
          type: "productUpdates/submit" as const,
        },
      ];
    },
    filterEvents: (state, event) => state.can(event),
    stopWhen: (state) => state.matches("success") || state.matches("failure"),
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

describe("createProductUpdatesMachine", () => {
  it("resets the form while preserving the submitted email after success", () => {
    const [path] = getPathsFromEvents(createProductUpdatesMachine(), [
      {
        type: "productUpdates/emailChanged",
        email: RAW_EMAIL,
      },
      {
        type: "productUpdates/submit",
      },
      {
        type: "productUpdates/submissionSucceeded",
        email: NORMALIZED_EMAIL,
        requestId: 1,
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the signup success flow");
    }

    expect(path.state.matches("success")).toBe(true);
    expect(path.state.context.email).toBe("");
    expect(path.state.context.feedback).toEqual({
      kind: "success",
      email: NORMALIZED_EMAIL,
    });
  });

  it("keeps the operator in a retryable failure state when submission fails", () => {
    const [path] = getPathsFromEvents(createProductUpdatesMachine(), [
      {
        type: "productUpdates/emailChanged",
        email: RAW_EMAIL,
      },
      {
        type: "productUpdates/submit",
      },
      {
        type: "productUpdates/submissionFailed",
        message: FAILURE_MESSAGE,
        requestId: 1,
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for the signup failure flow");
    }

    expect(path.state.matches("failure")).toBe(true);
    expect(path.state.context.email).toBe(RAW_EMAIL);
    expect(path.state.context.feedback).toEqual({
      kind: "failure",
      message: FAILURE_MESSAGE,
    });
  });

  describe("graph coverage", () => {
    for (const path of buildProductUpdatesShortestPaths()) {
      it(describeGraphPath(path), () => {
        if (path.state.matches("editing")) {
          expect(path.state.context.feedback).toEqual({
            kind: "idle",
          });
          expect(path.state.context.pendingSubmission).toBeNull();
          return;
        }

        if (path.state.matches("submitting")) {
          expect(path.state.context.pendingSubmission).toEqual({
            email: RAW_EMAIL,
            requestId: 1,
          });
          expect(path.state.context.feedback).toEqual({
            kind: "idle",
          });
          return;
        }

        if (path.state.matches("success")) {
          expect(path.state.context.email).toBe("");
          expect(path.state.context.feedback).toEqual({
            kind: "success",
            email: NORMALIZED_EMAIL,
          });
          expect(path.state.context.pendingSubmission).toBeNull();
          return;
        }

        expect(path.state.matches("failure")).toBe(true);
        expect(path.state.context.email).toBe(RAW_EMAIL);
        expect(path.state.context.feedback).toEqual({
          kind: "failure",
          message: FAILURE_MESSAGE,
        });
        expect(path.state.context.pendingSubmission).toBeNull();
      });
    }
  });
});
