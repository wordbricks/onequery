import { describe, expect, it } from "vitest";
import { createActor, fromPromise, waitFor } from "xstate";
import { getPathsFromEvents } from "xstate/graph";

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
    const actor = createActor(deviceAuthMachine, {
      input: {
        initialSession: {
          kind: "signedOut",
        },
        initialUserCode: USER_CODE,
      },
    });

    actor.start();

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches("verifying")).toBe(true);
    expect(readPanelView(snapshot)).toBe("verifying");
    expect(snapshot.context.pendingVerification).toEqual({
      requestId: 1,
      userCode: USER_CODE,
    });
  });

  it("uses the invoked verification actor output", async () => {
    const actor = createActor(
      deviceAuthMachine.provide({
        actors: {
          verifyDevice: fromPromise<
            VerifyDeviceActorOutput,
            VerifyDeviceActorInput
          >(async () => ({
            requestId: 1,
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

    const snapshot = await waitFor(
      actor,
      (state) => state.matches({ pending: "review" }),
      { timeout: 1000 }
    );

    expect(readPanelView(snapshot)).toBe("review");
    expect(snapshot.context.pendingVerification).toBeNull();
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
              requestId: 1,
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

  it("uses actor input for the initial route and session snapshots", () => {
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

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches("verifying")).toBe(true);
    expect(snapshot.context.pendingVerification).toEqual({
      requestId: 1,
      userCode: USER_CODE,
    });
    expect(readSessionEmail(snapshot)).toBe(SESSION_EMAIL);
  });

  it("returns verification failures to entry with the visible error message", () => {
    const actor = createActor(deviceAuthMachine, {
      input: {
        initialSession: {
          kind: "signedOut",
        },
        initialUserCode: USER_CODE,
      },
    });

    actor.start();
    actor.send({
      type: "deviceAuth/verificationFailed",
      message: VERIFY_ERROR_MESSAGE,
      requestId: 1,
    });

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches("entry")).toBe(true);
    expect(readPanelView(snapshot)).toBe("entry");
    expect(readDeviceAuthErrorMessage(snapshot)).toBe(VERIFY_ERROR_MESSAGE);
  });

  it("moves a verified signed-in device request through review into the result state", () => {
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
    actor.send({
      type: "deviceAuth/verificationSucceeded",
      requestId: 1,
      status: "pending",
      userCode: USER_CODE,
    });
    actor.send({
      type: "deviceAuth/approve",
    });
    actor.send({
      type: "deviceAuth/decisionSucceeded",
      message: "Approved in browser.",
      requestId: 2,
      title: "Device Approved",
      tone: "success",
    });

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches("result")).toBe(true);
    expect(readPanelView(snapshot)).toBe("result");
    expect(readSessionEmail(snapshot)).toBe(SESSION_EMAIL);
    expect(readDeviceAuthResult(snapshot)).toEqual({
      message: "Approved in browser.",
      title: "Device Approved",
      tone: "success",
    });
    expect(snapshot.context.pendingDecision).toBeNull();
  });

  it("stages an approval request when the signed-in reviewer approves", () => {
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
    actor.send({
      type: "deviceAuth/verificationSucceeded",
      requestId: 1,
      status: "pending",
      userCode: USER_CODE,
    });
    actor.send({
      type: "deviceAuth/approve",
    });

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches({ pending: "submittingDecision" })).toBe(true);
    expect(snapshot.context.pendingDecision).toEqual({
      action: "approve",
      requestId: 2,
      userCode: USER_CODE,
    });
  });

  it("shows the sign-in-required panel when the pending request has no session", () => {
    const actor = createActor(deviceAuthMachine, {
      input: {
        initialSession: {
          kind: "signedOut",
        },
        initialUserCode: USER_CODE,
      },
    });

    actor.start();
    actor.send({
      type: "deviceAuth/verificationSucceeded",
      requestId: 1,
      status: "pending",
      userCode: USER_CODE,
    });

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches({ pending: "signInRequired" })).toBe(true);
    expect(readPanelView(snapshot)).toBe("signInRequired");
  });

  it("returns to entry with the active code after a failed device decision", () => {
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
    actor.send({
      type: "deviceAuth/verificationSucceeded",
      requestId: 1,
      status: "pending",
      userCode: USER_CODE,
    });
    actor.send({
      type: "deviceAuth/deny",
    });
    actor.send({
      type: "deviceAuth/decisionFailed",
      message: DECISION_ERROR_MESSAGE,
      requestId: 2,
    });

    const snapshot = actor.getSnapshot();

    expect(snapshot.matches("entry")).toBe(true);
    expect(readPanelView(snapshot)).toBe("entry");
    expect(snapshot.context.inputCode).toBe(USER_CODE);
    expect(readDeviceAuthErrorMessage(snapshot)).toBe(DECISION_ERROR_MESSAGE);
    expect(snapshot.context.pendingDecision).toBeNull();
  });

  it("replaces the route when verification returns a canonical user code", () => {
    const [path] = getPathsFromEvents(deviceAuthMachine, [
      {
        type: "deviceAuth/inputChanged",
        value: USER_CODE_INPUT,
      },
      {
        type: "deviceAuth/submit",
      },
      {
        type: "deviceAuth/verificationSucceeded",
        requestId: 1,
        status: "approved",
        userCode: CANONICAL_USER_CODE,
      },
    ]);

    expect(path).toBeDefined();

    if (!path) {
      throw new Error("expected a graph path for canonical device code sync");
    }

    expect(path.state.matches("result")).toBe(true);
    expect(path.state.context.activeUserCode).toBe(CANONICAL_USER_CODE);
    expect(path.state.context.navigation).toEqual({
      id: 2,
      replace: true,
      userCode: CANONICAL_USER_CODE,
    });
  });

  it("keeps in-flight same-code navigation observable after verification succeeds", () => {
    const actor = createActor(deviceAuthMachine, {
      input: {
        initialSession: {
          email: SESSION_EMAIL,
          kind: "signedIn",
        },
        initialUserCode: null,
      },
    });

    actor.start();
    actor.send({
      type: "deviceAuth/inputChanged",
      value: USER_CODE_INPUT,
    });
    actor.send({
      type: "deviceAuth/submit",
    });
    actor.send({
      type: "deviceAuth/verificationSucceeded",
      requestId: 1,
      status: "pending",
      userCode: USER_CODE,
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
