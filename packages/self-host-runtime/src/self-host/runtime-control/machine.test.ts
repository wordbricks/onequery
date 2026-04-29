import { describe, expect, it } from "vitest";

import {
  createInitialRuntimeControlState,
  reduceRuntimeControlMachine,
} from "./machine";
import type {
  RuntimeControlFailure,
  RuntimeControlIdentity,
  RuntimeControlStopOperationConflict,
  RuntimeControlStopRequest,
} from "./machine";

const testSupervisorIdentity = {
  generation: 7n,
  pid: 1001,
  supervisorId: "gateway-supervisor:1001",
};

function runtimeControlIdentity(
  overrides: Partial<RuntimeControlIdentity> = {}
): RuntimeControlIdentity {
  return {
    dataDir: overrides.dataDir ?? "/tmp/onequery-data",
    launchId: overrides.launchId ?? "launch-a",
    pid: overrides.pid ?? 123,
    supervisor: overrides.supervisor ?? testSupervisorIdentity,
  };
}

function stopRequest(
  overrides: Partial<RuntimeControlStopRequest> = {}
): RuntimeControlStopRequest {
  return {
    completion: "cleanup_and_exit",
    graceTimeout: {
      nanos: 0,
      seconds: 30n,
    },
    reason: "gateway_stop",
    target: {
      dataDir: "/tmp/onequery-data",
      launchId: "launch-a",
      pid: 123,
      supervisor: testSupervisorIdentity,
    },
    ...overrides,
  };
}

describe("runtime control machine", () => {
  it("keeps watcher registry out of lifecycle machine state", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const state = createInitialRuntimeControlState({
      identity: runtimeControlIdentity(),
      now: startedAt,
    });

    expect(state).toEqual({
      identity: runtimeControlIdentity(),
      phase: "starting",
      recentStopOperationOutcomes: [],
      runtimeSequence: 1n,
      updatedAt: startedAt,
    });
    expect("watchers" in state).toBe(false);
  });

  it("records lifecycle shutdown failure transitions", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const stoppedAt = new Date("2026-04-27T00:00:01.000Z");
    const failedAt = new Date("2026-04-27T00:00:02.000Z");
    const initialState = createInitialRuntimeControlState({
      identity: runtimeControlIdentity(),
      now: startedAt,
    });
    const stopping = reduceRuntimeControlMachine(initialState, {
      occurredAt: stoppedAt,
      operationId: "018f0789-cc38-7d46-9a6b-83a2c8f0a001",
      request: stopRequest(),
      type: "stop_requested",
    });

    const reduction = reduceRuntimeControlMachine(stopping.state, {
      occurredAt: failedAt,
      phase: "shutdown_failed",
      reason: "gateway_stop",
      type: "lifecycle_transition_requested",
    });

    expect(reduction).toEqual({
      state: {
        ...stopping.state,
        failure: undefined,
        phase: "shutdown_failed",
        runtimeSequence: 3n,
        updatedAt: failedAt,
      },
      transition: {
        currentPhase: "shutdown_failed",
        failure: undefined,
        occurredAt: failedAt,
        previousPhase: "stopping",
        reason: "gateway_stop",
        runtimeSequence: 3n,
        transitionId: "runtime:3",
      },
      type: "transition",
    });
  });

  it.each([
    "checkpoint_failed",
    "internal",
    "resource_close_failed",
    "shutdown_rejected",
    "shutdown_timeout",
  ] satisfies RuntimeControlFailure["code"][])(
    "preserves lifecycle failure detail for %s transitions",
    (code) => {
      const startedAt = new Date("2026-04-27T00:00:00.000Z");
      const stoppedAt = new Date("2026-04-27T00:00:01.000Z");
      const failedAt = new Date("2026-04-27T00:00:02.000Z");
      const initialState = createInitialRuntimeControlState({
        identity: runtimeControlIdentity(),
        now: startedAt,
      });
      const stopping = reduceRuntimeControlMachine(initialState, {
        occurredAt: stoppedAt,
        operationId: "018f0789-cc38-7d46-9a6b-83a2c8f0a101",
        request: stopRequest(),
        type: "stop_requested",
      });
      const failure = {
        code,
        message: `runtime failure ${code}`,
        retryable: false,
      } satisfies RuntimeControlFailure;

      const reduction = reduceRuntimeControlMachine(stopping.state, {
        failure,
        occurredAt: failedAt,
        phase: "shutdown_failed",
        reason: "gateway_stop",
        type: "lifecycle_transition_requested",
      });

      expect(reduction).toMatchObject({
        state: {
          failure,
          phase: "shutdown_failed",
          runtimeSequence: 3n,
          updatedAt: failedAt,
        },
        transition: {
          currentPhase: "shutdown_failed",
          failure,
          previousPhase: "stopping",
          reason: "gateway_stop",
          runtimeSequence: 3n,
          transitionId: "runtime:3",
        },
        type: "transition",
      });
    }
  );

  it("records lifecycle release failures as terminal shutdown failures", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const stoppingAt = new Date("2026-04-27T00:00:01.000Z");
    const failedAt = new Date("2026-04-27T00:00:02.000Z");
    const initialState = createInitialRuntimeControlState({
      identity: runtimeControlIdentity(),
      now: startedAt,
    });
    const stopping = reduceRuntimeControlMachine(initialState, {
      occurredAt: stoppingAt,
      operationId: "018f0789-cc38-7d46-9a6b-83a2c8f0a002",
      request: stopRequest(),
      type: "stop_requested",
    });

    const reduction = reduceRuntimeControlMachine(stopping.state, {
      message: "failed to release runtime lifecycle lease for gateway_stop",
      occurredAt: failedAt,
      reason: "gateway_stop",
      type: "lifecycle_release_failed",
    });
    const failure = {
      code: "internal",
      message: "failed to release runtime lifecycle lease for gateway_stop",
      retryable: false,
    } as const;

    expect(reduction).toEqual({
      state: {
        ...stopping.state,
        failure,
        phase: "shutdown_failed",
        runtimeSequence: 3n,
        updatedAt: failedAt,
      },
      transition: {
        currentPhase: "shutdown_failed",
        failure,
        occurredAt: failedAt,
        previousPhase: "stopping",
        reason: "gateway_stop",
        runtimeSequence: 3n,
        transitionId: "runtime:3",
      },
      type: "transition",
    });
  });

  it("records shutdown timeout as a terminal failure", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const stoppingAt = new Date("2026-04-27T00:00:01.000Z");
    const timedOutAt = new Date("2026-04-27T00:00:02.000Z");
    const staleTransitionAt = new Date("2026-04-27T00:00:03.000Z");
    const operationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a003";
    const graceTimeout = {
      nanos: 0,
      seconds: 30n,
    };
    const initialState = createInitialRuntimeControlState({
      identity: runtimeControlIdentity(),
      now: startedAt,
    });
    const stopping = reduceRuntimeControlMachine(initialState, {
      occurredAt: stoppingAt,
      operationId,
      request: stopRequest({
        graceTimeout,
      }),
      type: "stop_requested",
    });

    const timedOut = reduceRuntimeControlMachine(stopping.state, {
      graceTimeout,
      occurredAt: timedOutAt,
      operationId,
      reason: "gateway_stop",
      type: "shutdown_timeout_elapsed",
    });
    const failure = {
      code: "shutdown_timeout",
      message: "runtime shutdown timed out after 30s/0ns for gateway_stop",
      retryable: false,
    } as const;

    expect(timedOut).toEqual({
      state: {
        ...stopping.state,
        failure,
        phase: "shutdown_failed",
        runtimeSequence: 3n,
        updatedAt: timedOutAt,
      },
      transition: {
        callerOperationId: operationId,
        currentPhase: "shutdown_failed",
        failure,
        occurredAt: timedOutAt,
        previousPhase: "stopping",
        reason: "gateway_stop",
        runtimeSequence: 3n,
        transitionId: "runtime:3",
      },
      type: "transition",
    });

    const staleCheckpoint = reduceRuntimeControlMachine(timedOut.state, {
      occurredAt: staleTransitionAt,
      phase: "checkpointing",
      reason: "gateway_stop",
      type: "lifecycle_transition_requested",
    });
    const staleRelease = reduceRuntimeControlMachine(timedOut.state, {
      occurredAt: staleTransitionAt,
      reason: "gateway_stop",
      type: "lifecycle_release_succeeded",
    });

    expect(staleCheckpoint).toEqual({
      state: timedOut.state,
      type: "transition",
    });
    expect(staleRelease).toEqual({
      state: timedOut.state,
      type: "transition",
    });
  });

  it("reports stop requests after shutdown failure as already finished", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const failedAt = new Date("2026-04-27T00:00:01.000Z");
    const retryAt = new Date("2026-04-27T00:00:02.000Z");
    const operationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a003";
    const initialState = createInitialRuntimeControlState({
      identity: runtimeControlIdentity(),
      now: startedAt,
    });
    const failed = reduceRuntimeControlMachine(initialState, {
      message: "failed to release runtime lifecycle lease for gateway_stop",
      occurredAt: failedAt,
      reason: "gateway_stop",
      type: "lifecycle_release_failed",
    });

    const reduction = reduceRuntimeControlMachine(failed.state, {
      occurredAt: retryAt,
      operationId,
      request: stopRequest(),
      type: "stop_requested",
    });

    expect(reduction).toMatchObject({
      disposition: "already_finished",
      idempotentReplay: false,
      response: {
        disposition: "already_finished",
        operationId,
        status: {
          phase: "shutdown_failed",
          runtimeSequence: 2n,
          updatedAt: failedAt,
        },
      },
      state: {
        ...failed.state,
        recentStopOperationOutcomes: [
          {
            disposition: "already_finished",
            operationId,
            request: stopRequest(),
            status: {
              failure: failed.state.failure,
              identity: failed.state.identity,
              phase: "shutdown_failed",
              runtimeSequence: 2n,
              updatedAt: failedAt,
            },
          },
        ],
      },
      type: "stop",
    });
  });

  it("replays the original stop operation outcome for idempotent retries", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const stoppingAt = new Date("2026-04-27T00:00:01.000Z");
    const drainingAt = new Date("2026-04-27T00:00:02.000Z");
    const retryAt = new Date("2026-04-27T00:00:03.000Z");
    const operationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a004";
    const initialState = createInitialRuntimeControlState({
      identity: runtimeControlIdentity(),
      now: startedAt,
    });
    const accepted = reduceRuntimeControlMachine(initialState, {
      occurredAt: stoppingAt,
      operationId,
      request: stopRequest(),
      type: "stop_requested",
    });
    expect(accepted.type).toBe("stop");
    if (accepted.type !== "stop" || "conflict" in accepted) {
      throw new Error("expected accepted stop reduction");
    }
    const draining = reduceRuntimeControlMachine(accepted.state, {
      occurredAt: drainingAt,
      phase: "draining",
      reason: "gateway_stop",
      type: "lifecycle_transition_requested",
    });
    expect(draining.type).toBe("transition");
    if (draining.type !== "transition") {
      throw new Error(`expected transition reduction, got ${draining.type}`);
    }

    const replay = reduceRuntimeControlMachine(draining.state, {
      occurredAt: retryAt,
      operationId,
      request: stopRequest(),
      type: "stop_requested",
    });
    expect(replay.type).toBe("stop");
    if (replay.type !== "stop" || "conflict" in replay) {
      throw new Error("expected stop replay reduction");
    }

    expect(replay).toMatchObject({
      disposition: "accepted",
      idempotentReplay: true,
      state: draining.state,
      type: "stop",
    });
    expect(replay.transition).toBeUndefined();
    expect(replay.response).toEqual(accepted.response);
    expect(replay.response.status).toMatchObject({
      phase: "stopping",
      runtimeSequence: 2n,
      updatedAt: stoppingAt,
    });
    expect(replay.state.recentStopOperationOutcomes).toHaveLength(1);
  });

  it.each([
    {
      actual: stopRequest({
        target: {
          dataDir: "/tmp/onequery-data",
          launchId: "launch-a",
          pid: undefined as unknown as number,
          supervisor: testSupervisorIdentity,
        },
      }),
      field: "target.pid",
      name: "target",
      actualValue: "unset",
      expectedValue: "123",
    },
    {
      actual: stopRequest({
        reason: "operator_stop",
      }),
      field: "reason",
      name: "reason",
      actualValue: "operator_stop",
      expectedValue: "gateway_stop",
    },
    {
      actual: stopRequest({
        completion: "cleanup_only",
      }),
      field: "completion",
      name: "completion",
      actualValue: "cleanup_only",
      expectedValue: "cleanup_and_exit",
    },
    {
      actual: stopRequest({
        graceTimeout: {
          nanos: 0,
          seconds: 45n,
        },
      }),
      field: "grace_timeout",
      name: "grace timeout",
      actualValue: "45s/0ns",
      expectedValue: "30s/0ns",
    },
  ] satisfies {
    actual: RuntimeControlStopRequest;
    actualValue: string;
    expectedValue: string;
    field: RuntimeControlStopOperationConflict["field"];
    name: string;
  }[])(
    "rejects operation id reuse with a different stop request $name",
    ({ actual, actualValue, expectedValue, field }) => {
      const startedAt = new Date("2026-04-27T00:00:00.000Z");
      const stoppingAt = new Date("2026-04-27T00:00:01.000Z");
      const retryAt = new Date("2026-04-27T00:00:02.000Z");
      const operationId = "018f0789-cc38-7d46-9a6b-83a2c8f0a005";
      const initialState = createInitialRuntimeControlState({
        identity: runtimeControlIdentity(),
        now: startedAt,
      });
      const accepted = reduceRuntimeControlMachine(initialState, {
        occurredAt: stoppingAt,
        operationId,
        request: stopRequest(),
        type: "stop_requested",
      });
      expect(accepted.type).toBe("stop");
      if (accepted.type !== "stop" || "conflict" in accepted) {
        throw new Error("expected accepted stop reduction");
      }

      const conflict = reduceRuntimeControlMachine(accepted.state, {
        occurredAt: retryAt,
        operationId,
        request: actual,
        type: "stop_requested",
      });

      expect(conflict).toEqual({
        conflict: {
          actual: actualValue,
          expected: expectedValue,
          field,
          operationId,
        },
        idempotentReplay: false,
        state: accepted.state,
        type: "stop",
      });
    }
  );
});
