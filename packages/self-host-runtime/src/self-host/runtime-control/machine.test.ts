import { describe, expect, it } from "vitest";

import {
  createInitialRuntimeControlState,
  reduceRuntimeControlMachine,
} from "./machine";

describe("runtime control machine", () => {
  it("records lifecycle shutdown failure transitions", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const stoppedAt = new Date("2026-04-27T00:00:01.000Z");
    const failedAt = new Date("2026-04-27T00:00:02.000Z");
    const initialState = createInitialRuntimeControlState({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      now: startedAt,
    });
    const stopping = reduceRuntimeControlMachine(initialState, {
      completion: "cleanup_and_exit",
      occurredAt: stoppedAt,
      operationId: "stop-1",
      reason: "gateway_stop",
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
        sequence: 3n,
        updatedAt: failedAt,
      },
      transition: {
        currentPhase: "shutdown_failed",
        failure: undefined,
        occurredAt: failedAt,
        operation: {
          name: "lifecycle",
          operationId: `lifecycle:shutdown_failed:${failedAt.toISOString()}`,
        },
        previousPhase: "stopping",
        reason: "gateway_stop",
        sequence: 3n,
      },
      type: "transition",
    });
  });

  it("records lifecycle release failures as terminal shutdown failures", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const stoppingAt = new Date("2026-04-27T00:00:01.000Z");
    const failedAt = new Date("2026-04-27T00:00:02.000Z");
    const initialState = createInitialRuntimeControlState({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      now: startedAt,
    });
    const stopping = reduceRuntimeControlMachine(initialState, {
      completion: "cleanup_and_exit",
      occurredAt: stoppingAt,
      operationId: "stop-1",
      reason: "gateway_stop",
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
        sequence: 3n,
        updatedAt: failedAt,
      },
      transition: {
        currentPhase: "shutdown_failed",
        failure,
        occurredAt: failedAt,
        operation: {
          name: "release",
          operationId: `release_failed:gateway_stop:${failedAt.toISOString()}`,
        },
        previousPhase: "stopping",
        reason: "gateway_stop",
        sequence: 3n,
      },
      type: "transition",
    });
  });

  it("reports stop requests after shutdown failure as already finished", () => {
    const startedAt = new Date("2026-04-27T00:00:00.000Z");
    const failedAt = new Date("2026-04-27T00:00:01.000Z");
    const initialState = createInitialRuntimeControlState({
      identity: {
        dataDir: "/tmp/onequery-data",
        launchId: "launch-a",
        pid: 123,
      },
      now: startedAt,
    });
    const failed = reduceRuntimeControlMachine(initialState, {
      message: "failed to release runtime lifecycle lease for gateway_stop",
      occurredAt: failedAt,
      reason: "gateway_stop",
      type: "lifecycle_release_failed",
    });

    const reduction = reduceRuntimeControlMachine(failed.state, {
      completion: "cleanup_and_exit",
      occurredAt: new Date("2026-04-27T00:00:02.000Z"),
      operationId: "stop-2",
      reason: "gateway_stop",
      type: "stop_requested",
    });

    expect(reduction).toEqual({
      disposition: "already_finished",
      state: failed.state,
      type: "stop",
    });
  });
});
