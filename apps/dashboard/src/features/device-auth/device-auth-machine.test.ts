import { describe, expect, it, vi } from "vitest";
import { createActor, fromPromise, waitFor } from "xstate";

import {
  DeviceActorRequestError,
  deviceAuthMachine,
  readDeviceAuthErrorMessage,
  readDeviceAuthResult,
  readNavigationErrorMessage,
  readPanelView,
  readSessionEmail,
} from "./device-auth-machine";
import type {
  SubmitDeviceDecisionActorInput,
  SubmitDeviceDecisionActorOutput,
  VerifyDeviceActorInput,
  VerifyDeviceActorOutput,
} from "./device-auth-machine";

const USER_CODE_INPUT = "ABCD-1234";
const USER_CODE = "ABCD1234";
const CANONICAL_USER_CODE = "WXYZ9876";
const SESSION_EMAIL = "jane@onequery.dev";
const VERIFY_ERROR_MESSAGE = "Device code expired";
const DECISION_ERROR_MESSAGE = "The device request could not be completed.";

describe("deviceAuthMachine", () => {
  it("keeps browser-visible navigation failures generic", () => {
    expect(
      readNavigationErrorMessage(new Error("secret redirect failure"))
    ).toBe("Couldn't update the device URL. Try the same action again.");
  });

  it("stages verification from the initial device code", () => {
    const verifyDevice = vi.fn(
      () => new Promise<VerifyDeviceActorOutput>(() => undefined)
    );
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(verifyDevice),
        },
      }),
      {
        input: {
          initialSession: {
            kind: "signedOut",
          },
          initialUserCode: USER_CODE,
        },
      }
    );

    actor.start();

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches("verifying")).toBe(true);
    expect(readPanelView(snapshot)).toBe("verifying");
    expect(verifyDevice).toHaveBeenCalledOnce();
    expect(verifyDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          userCode: USER_CODE,
        },
      })
    );
  });

  it("reviews an initial signed-in device code without a preflight verify", async () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => {
            throw new Error("signed-in initial codes should not preflight");
          }),
        },
      }),
      {
        input: {
          initialSession: {
            email: SESSION_EMAIL,
            kind: "signedIn",
          },
          initialUserCode: USER_CODE,
        },
      }
    );

    actor.start();

    const snapshot = await waitFor(
      actor,
      (state) => state.matches({ pending: "review" }),
      { timeout: 1000 }
    );

    expect(readPanelView(snapshot)).toBe("review");
    expect(snapshot.context.activeUserCode).toBe(USER_CODE);
  });

  it("uses invoked verification actor errors", async () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => {
            throw new DeviceActorRequestError({
              message: VERIFY_ERROR_MESSAGE,
            });
          }),
        },
      }),
      {
        input: {
          initialSession: {
            kind: "signedOut",
          },
          initialUserCode: USER_CODE,
        },
      }
    );

    actor.start();

    const snapshot = await waitFor(actor, (state) => state.matches("entry"), {
      timeout: 1000,
    });

    expect(readPanelView(snapshot)).toBe("entry");
    expect(readDeviceAuthErrorMessage(snapshot)).toBe(VERIFY_ERROR_MESSAGE);
  });

  it("uses actor input for signed-in initial route and session snapshots", async () => {
    const actor = createActor(deviceAuthMachine, {
      input: {
        initialSession: {
          email: SESSION_EMAIL,
          kind: "signedIn",
        },
        initialUserCode: USER_CODE,
      },
    });

    actor.start();

    const snapshot = await waitFor(
      actor,
      (state) => state.matches({ pending: "review" }),
      { timeout: 1000 }
    );

    expect(readPanelView(snapshot)).toBe("review");
    expect(readSessionEmail(snapshot)).toBe(SESSION_EMAIL);
  });

  it("returns verification failures to entry with the visible error message", () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => {
            throw new DeviceActorRequestError({
              message: VERIFY_ERROR_MESSAGE,
            });
          }),
        },
      }),
      {
        input: {
          initialSession: {
            kind: "signedOut",
          },
          initialUserCode: USER_CODE,
        },
      }
    );

    actor.start();

    return waitFor(actor, (state) => state.matches("entry"), {
      timeout: 1000,
    }).then((snapshot) => {
      expect(readPanelView(snapshot)).toBe("entry");
      expect(readDeviceAuthErrorMessage(snapshot)).toBe(VERIFY_ERROR_MESSAGE);
    });
  });

  it("moves a verified signed-in device request through review into the result state", async () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          submitDeviceDecision: fromPromise<
            SubmitDeviceDecisionActorOutput,
            SubmitDeviceDecisionActorInput
          >(async () => ({
            message: "Approved in browser.",
            title: "Device Approved",
            tone: "success",
          })),
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => ({
            status: "pending",
            userCode: USER_CODE,
          })),
        },
      }),
      {
        input: {
          initialSession: {
            email: SESSION_EMAIL,
            kind: "signedIn",
          },
          initialUserCode: USER_CODE,
        },
      }
    );

    actor.start();
    await waitFor(actor, (state) => state.matches({ pending: "review" }), {
      timeout: 1000,
    });
    actor.send({
      type: "deviceAuth/approve",
    });
    const snapshot = await waitFor(actor, (state) => state.matches("result"), {
      timeout: 1000,
    });

    expect(readPanelView(snapshot)).toBe("result");
    expect(readSessionEmail(snapshot)).toBe(SESSION_EMAIL);
    expect(readDeviceAuthResult(snapshot)).toEqual({
      message: "Approved in browser.",
      title: "Device Approved",
      tone: "success",
    });
  });

  it("stages an approval request when the signed-in reviewer approves", async () => {
    let decisionInput: SubmitDeviceDecisionActorInput | null = null;
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          submitDeviceDecision: fromPromise<
            SubmitDeviceDecisionActorOutput,
            SubmitDeviceDecisionActorInput
          >(({ input }) => {
            decisionInput = input;
            return new Promise<SubmitDeviceDecisionActorOutput>(() => {
              // Keep the actor in the approving state for inspection.
            });
          }),
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => ({
            status: "pending",
            userCode: USER_CODE,
          })),
        },
      }),
      {
        input: {
          initialSession: {
            email: SESSION_EMAIL,
            kind: "signedIn",
          },
          initialUserCode: USER_CODE,
        },
      }
    );

    actor.start();
    await waitFor(actor, (state) => state.matches({ pending: "review" }), {
      timeout: 1000,
    });
    actor.send({
      type: "deviceAuth/approve",
    });

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches({ pending: "approving" })).toBe(true);
    expect(decisionInput).toEqual({
      action: "approve",
      userCode: USER_CODE,
    });
  });

  it("shows the sign-in-required panel when the pending request has no session", async () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => ({
            status: "pending",
            userCode: USER_CODE,
          })),
        },
      }),
      {
        input: {
          initialSession: {
            kind: "signedOut",
          },
          initialUserCode: USER_CODE,
        },
      }
    );

    actor.start();
    const snapshot = await waitFor(
      actor,
      (state) => state.matches({ pending: "signInRequired" }),
      { timeout: 1000 }
    );

    expect(readPanelView(snapshot)).toBe("signInRequired");
  });

  it("returns to entry with the active code after a failed device decision", async () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          submitDeviceDecision: fromPromise<
            SubmitDeviceDecisionActorOutput,
            SubmitDeviceDecisionActorInput
          >(async () => {
            throw new DeviceActorRequestError({
              message: DECISION_ERROR_MESSAGE,
            });
          }),
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => ({
            status: "pending",
            userCode: USER_CODE,
          })),
        },
      }),
      {
        input: {
          initialSession: {
            email: SESSION_EMAIL,
            kind: "signedIn",
          },
          initialUserCode: USER_CODE,
        },
      }
    );

    actor.start();
    await waitFor(actor, (state) => state.matches({ pending: "review" }), {
      timeout: 1000,
    });
    actor.send({
      type: "deviceAuth/deny",
    });
    const snapshot = await waitFor(actor, (state) => state.matches("entry"), {
      timeout: 1000,
    });

    expect(readPanelView(snapshot)).toBe("entry");
    expect(snapshot.context.inputCode).toBe(USER_CODE);
    expect(readDeviceAuthErrorMessage(snapshot)).toBe(DECISION_ERROR_MESSAGE);

    actor.send({
      type: "deviceAuth/inputChanged",
      value: CANONICAL_USER_CODE,
    });

    const editedSnapshot = actor.getSnapshot();

    expect(editedSnapshot.matches("entry")).toBe(true);
    expect(editedSnapshot.context.inputCode).toBe(CANONICAL_USER_CODE);
  });

  it("replaces the route when verification returns a canonical user code", async () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => ({
            status: "approved",
            userCode: CANONICAL_USER_CODE,
          })),
        },
      }),
      {
        input: {
          initialSession: {
            kind: "signedOut",
          },
          initialUserCode: null,
        },
      }
    );

    actor.start();
    actor.send({
      type: "deviceAuth/inputChanged",
      value: USER_CODE_INPUT,
    });
    actor.send({
      type: "deviceAuth/submit",
    });
    const snapshot = await waitFor(actor, (state) => state.matches("result"), {
      timeout: 1000,
    });

    expect(snapshot.context.activeUserCode).toBe(CANONICAL_USER_CODE);
    expect(snapshot.context.navigation).toEqual({
      id: 2,
      replace: true,
      userCode: CANONICAL_USER_CODE,
    });
  });

  it("keeps in-flight same-code navigation observable after verification succeeds", async () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => ({
            status: "pending",
            userCode: USER_CODE,
          })),
        },
      }),
      {
        input: {
          initialSession: {
            email: SESSION_EMAIL,
            kind: "signedIn",
          },
          initialUserCode: null,
        },
      }
    );

    actor.start();
    actor.send({
      type: "deviceAuth/inputChanged",
      value: USER_CODE_INPUT,
    });
    actor.send({
      type: "deviceAuth/submit",
    });
    await waitFor(actor, (state) => state.matches({ pending: "review" }), {
      timeout: 1000,
    });
    actor.send({
      id: 1,
      message: "Couldn't update the device URL. Try the same action again.",
      type: "deviceAuth/navigationFailed",
    });

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches({ pending: "review" })).toBe(true);
    expect(readDeviceAuthErrorMessage(snapshot)).toBe(
      "Couldn't update the device URL. Try the same action again."
    );
  });
});
