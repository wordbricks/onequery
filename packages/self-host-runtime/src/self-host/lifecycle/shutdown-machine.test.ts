import { oneshot } from "antiox/sync/oneshot";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RuntimeShutdownError } from "./errors";
import {
  initialShutdownMachineState,
  reduceShutdownMachine,
} from "./shutdown-machine";
import type {
  ShutdownMachineEffect,
  ShutdownMachineState,
  ShutdownResult,
} from "./shutdown-machine";

describe("shutdown machine", () => {
  it("starts a shutdown from idle state", () => {
    const responseTx = createResponseSender();

    const transition = reduceShutdownMachine(initialShutdownMachineState, {
      type: "shutdown_requested",
      completion: "cleanup_only",
      reason: "manual",
      responseTx,
    });

    expect(transition.effects).toEqual([
      {
        type: "start_shutdown",
        reason: "manual",
      },
    ]);
    expect(transition.state).toMatchObject({
      status: "shutting_down",
      completion: "cleanup_only",
      disposeRequested: false,
      reason: "manual",
    });
    expectShuttingDown(transition.state);
    expect(transition.state.responders).toHaveLength(1);
    expect(transition.state.responders[0]).toBe(responseTx);
  });

  it("coalesces duplicate shutdown requests and upgrades exit intent", () => {
    const firstResponseTx = createResponseSender();
    const secondResponseTx = createResponseSender();
    const started = reduceShutdownMachine(initialShutdownMachineState, {
      type: "shutdown_requested",
      completion: "cleanup_only",
      reason: "manual",
      responseTx: firstResponseTx,
    });

    const transition = reduceShutdownMachine(started.state, {
      type: "shutdown_requested",
      completion: "cleanup_and_exit",
      reason: "SIGTERM",
      responseTx: secondResponseTx,
    });

    expect(transition.effects).toEqual([]);
    expectShuttingDown(transition.state);
    expect(transition.state.completion).toBe("cleanup_and_exit");
    expect(transition.state.reason).toBe("manual");
    expect(transition.state.responders).toEqual([
      firstResponseTx,
      secondResponseTx,
    ]);
  });

  it("responds to all waiters and exits after cleanup-and-exit completes", () => {
    const firstResponseTx = createResponseSender();
    const secondResponseTx = createResponseSender();
    const result: ShutdownResult = Result.ok(undefined);
    const state: ShutdownMachineState = {
      status: "shutting_down",
      completion: "cleanup_and_exit",
      disposeRequested: false,
      reason: "SIGTERM",
      responders: [firstResponseTx, secondResponseTx],
    };

    const transition = reduceShutdownMachine(state, {
      type: "shutdown_finished",
      result,
    });

    expect(transition.effects).toHaveLength(2);
    expectRespondEffect(transition.effects[0], result, [
      firstResponseTx,
      secondResponseTx,
    ]);
    expect(transition.effects[1]).toEqual({
      type: "exit",
      code: 0,
    });
    expect(transition.state).toEqual({
      status: "finished",
      exitHandled: true,
      result,
    });
  });

  it("closes the event receiver after a disposed in-flight shutdown finishes", () => {
    const responseTx = createResponseSender();
    const result: ShutdownResult = Result.ok(undefined);
    const started = reduceShutdownMachine(initialShutdownMachineState, {
      type: "shutdown_requested",
      completion: "cleanup_only",
      reason: "manual",
      responseTx,
    });
    const disposed = reduceShutdownMachine(started.state, {
      type: "controller_disposed",
    });

    const transition = reduceShutdownMachine(disposed.state, {
      type: "shutdown_finished",
      result,
    });

    expect(transition.effects).toHaveLength(2);
    expectRespondEffect(transition.effects[0], result, [responseTx]);
    expect(transition.effects[1]).toEqual({
      type: "close_event_receiver",
    });
    expect(transition.state).toEqual({
      status: "disposed",
    });
  });

  it("does not exit twice after a finished shutdown", () => {
    const result = shutdownFailure("manual");
    const firstResponseTx = createResponseSender();
    const secondResponseTx = createResponseSender();
    const state: ShutdownMachineState = {
      status: "finished",
      exitHandled: false,
      result,
    };

    const firstTransition = reduceShutdownMachine(state, {
      type: "shutdown_requested",
      completion: "cleanup_and_exit",
      reason: "SIGTERM",
      responseTx: firstResponseTx,
    });

    expect(firstTransition.effects).toHaveLength(2);
    expectRespondEffect(firstTransition.effects[0], result, [firstResponseTx]);
    expect(firstTransition.effects[1]).toEqual({
      type: "exit",
      code: 1,
    });
    expectFinished(firstTransition.state);
    expect(firstTransition.state.exitHandled).toBe(true);

    const secondTransition = reduceShutdownMachine(firstTransition.state, {
      type: "shutdown_requested",
      completion: "cleanup_and_exit",
      reason: "SIGINT",
      responseTx: secondResponseTx,
    });

    expect(secondTransition.effects).toHaveLength(1);
    expectRespondEffect(secondTransition.effects[0], result, [
      secondResponseTx,
    ]);
    expectFinished(secondTransition.state);
    expect(secondTransition.state.exitHandled).toBe(true);
  });

  it("responds with a shutdown error after disposal", () => {
    const responseTx = createResponseSender();

    const transition = reduceShutdownMachine(
      {
        status: "disposed",
      },
      {
        type: "shutdown_requested",
        completion: "cleanup_only",
        reason: "manual",
        responseTx,
      }
    );

    expect(transition.effects).toHaveLength(1);
    const effect = transition.effects[0];
    expect(effect?.type).toBe("respond");
    if (effect?.type !== "respond") {
      throw new Error("expected respond effect");
    }
    expect(effect.responders).toEqual([responseTx]);
    expect(effect.result.isErr()).toBe(true);
    if (effect.result.isErr()) {
      expect(effect.result.error).toBeInstanceOf(RuntimeShutdownError);
    }
    expect(transition.state).toEqual({
      status: "disposed",
    });
  });

  it("ignores stale shutdown completion events while idle", () => {
    const transition = reduceShutdownMachine(initialShutdownMachineState, {
      type: "shutdown_finished",
      result: Result.ok(undefined),
    });

    expect(transition.effects).toEqual([]);
    expect(transition.state).toBe(initialShutdownMachineState);
  });
});

function createResponseSender() {
  return oneshot<ShutdownResult>()[0];
}

function shutdownFailure(reason: string): ShutdownResult {
  return Result.err(
    new RuntimeShutdownError({
      cause: new Error("failed"),
      message: `failed to shut down runtime for ${reason}`,
      reason,
    })
  );
}

function expectShuttingDown(
  state: ShutdownMachineState
): asserts state is Extract<ShutdownMachineState, { status: "shutting_down" }> {
  expect(state.status).toBe("shutting_down");
}

function expectFinished(
  state: ShutdownMachineState
): asserts state is Extract<ShutdownMachineState, { status: "finished" }> {
  expect(state.status).toBe("finished");
}

function expectRespondEffect(
  effect: ShutdownMachineEffect | undefined,
  result: ShutdownResult,
  responders: Extract<ShutdownMachineEffect, { type: "respond" }>["responders"]
): void {
  expect(effect?.type).toBe("respond");
  if (effect?.type !== "respond") {
    throw new Error("expected respond effect");
  }
  expect(effect.result).toBe(result);
  expect(effect.responders).toEqual(responders);
}
