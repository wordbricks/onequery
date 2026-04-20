import { describe, expect, it } from "vitest";
import { createActor, waitFor } from "xstate";

import { createProductUpdatesMachine } from "./product-updates.machine";

describe("createProductUpdatesMachine", () => {
  it("resets the form while preserving the submitted email after success", async () => {
    const actor = createActor(
      createProductUpdatesMachine({
        subscribeProductUpdates: async ({ email }) => ({
          email: email.trim().toLowerCase(),
        }),
      })
    );

    actor.start();
    actor.send({
      type: "productUpdates/emailChanged",
      email: "TEAM@ONEQUERY.dev ",
    });
    actor.send({ type: "productUpdates/submit" });

    await waitFor(actor, (snapshot) => snapshot.matches("success"));

    expect(actor.getSnapshot().context.email).toBe("");
    expect(actor.getSnapshot().context.lastSubmittedEmail).toBe(
      "team@onequery.dev"
    );
    expect(actor.getSnapshot().context.successfulSubmissionCount).toBe(1);
  });

  it("keeps the operator in a retryable failure state when RPC submission fails", async () => {
    const actor = createActor(
      createProductUpdatesMachine({
        subscribeProductUpdates: async () => {
          throw new Error("Webhook unavailable");
        },
      })
    );

    actor.start();
    actor.send({
      type: "productUpdates/emailChanged",
      email: "team@onequery.dev",
    });
    actor.send({ type: "productUpdates/submit" });

    await waitFor(actor, (snapshot) => snapshot.matches("failure"));

    expect(actor.getSnapshot().context.email).toBe("team@onequery.dev");
    expect(actor.getSnapshot().context.errorMessage).toBe(
      "Webhook unavailable"
    );
  });

  it("ignores telemetry failures after a successful signup", async () => {
    const actor = createActor(
      createProductUpdatesMachine({
        subscribeProductUpdates: async ({ email }) => ({ email }),
        trackProductUpdatesSignup: () => {
          throw new Error("analytics boom");
        },
      })
    );

    actor.start();
    actor.send({
      type: "productUpdates/emailChanged",
      email: "team@onequery.dev",
    });
    actor.send({ type: "productUpdates/submit" });

    await waitFor(actor, (snapshot) => snapshot.matches("success"));
    await Promise.resolve();

    expect(actor.getSnapshot().matches("success")).toBe(true);
    expect(actor.getSnapshot().context.lastSubmittedEmail).toBe(
      "team@onequery.dev"
    );
  });
});
