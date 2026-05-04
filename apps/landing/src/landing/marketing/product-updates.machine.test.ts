import { describe, expect, it } from "vitest";
import { createActor, fromPromise, waitFor } from "xstate";
import { getShortestPaths } from "xstate/graph";

import { createProductUpdatesMachine } from "./product-updates.machine";
import type {
  ProductUpdatesSubmissionInput,
  ProductUpdatesSubmissionOutput,
} from "./product-updates.machine";

const RAW_EMAIL = "TEAM@ONEQUERY.dev ";
const NORMALIZED_EMAIL = "team@onequery.dev";
const FAILURE_MESSAGE = "Webhook unavailable";

function buildProductUpdatesShortestPaths() {
  return getShortestPaths(createProductUpdatesMachine(), {
    events: (state) => {
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
    stopWhen: (state) => state.matches("submitting"),
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
  it("resets the form while preserving the submitted email after success", async () => {
    const actor = createActor(createProductUpdatesMachine());

    actor.start();
    actor.send({
      type: "productUpdates/emailChanged",
      email: RAW_EMAIL,
    });
    actor.send({
      type: "productUpdates/submit",
    });

    const success = await waitFor(actor, (snapshot) =>
      snapshot.matches("success")
    );

    expect(success.context.email).toBe("");
    expect(success.context.feedback).toEqual({
      kind: "success",
      email: NORMALIZED_EMAIL,
    });
  });

  it("keeps the operator in a retryable failure state when submission fails", async () => {
    const actor = createActor(
      createProductUpdatesMachine().provide({
        actors: {
          submitProductUpdates: fromPromise<
            ProductUpdatesSubmissionOutput,
            ProductUpdatesSubmissionInput
          >(async () => {
            throw new Error(FAILURE_MESSAGE);
          }),
        },
      })
    );

    actor.start();
    actor.send({
      type: "productUpdates/emailChanged",
      email: RAW_EMAIL,
    });
    actor.send({
      type: "productUpdates/submit",
    });

    const failure = await waitFor(actor, (snapshot) =>
      snapshot.matches("failure")
    );

    expect(failure.context.email).toBe(RAW_EMAIL);
    expect(failure.context.feedback).toEqual({
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
          return;
        }

        expect(path.state.matches("submitting")).toBe(true);
        expect(path.state.context.email).toBe(RAW_EMAIL);
        expect(path.state.context.feedback).toEqual({
          kind: "idle",
        });
      });
    }
  });
});
