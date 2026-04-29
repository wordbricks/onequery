import { unreachable } from "antiox/panic";

import type {
  RuntimeLifecyclePhase,
  RuntimeShutdownCompletion,
} from "../lifecycle/types";

export type RuntimeControlPhase = RuntimeLifecyclePhase | "failed" | "stopped";

export type RuntimeControlFailureCode = "internal";

export interface RuntimeControlIdentity {
  dataDir: string;
  launchId: string;
  pid: number;
  supervisorGeneration?: bigint;
  supervisorPid?: number;
}

export interface RuntimeControlFailure {
  code: RuntimeControlFailureCode;
  message: string;
  retryable: boolean;
}

export interface RuntimeControlTransition {
  callerOperationId?: string;
  correlationId?: string;
  currentPhase: RuntimeControlPhase;
  failure?: RuntimeControlFailure;
  occurredAt: Date;
  previousPhase: RuntimeControlPhase;
  reason: string;
  runtimeSequence: bigint;
  transitionId: string;
}

export interface RuntimeControlStatusSnapshot {
  failure?: RuntimeControlFailure;
  identity: RuntimeControlIdentity;
  phase: RuntimeControlPhase;
  runtimeSequence: bigint;
  updatedAt: Date;
}

export interface RuntimeControlWatcher {
  afterRuntimeSequence: bigint;
  id: number;
}

export interface RuntimeControlStopRequestTarget {
  dataDir: string;
  launchId: string;
  pid?: number;
  supervisorGeneration?: bigint;
  supervisorPid?: number;
}

export interface RuntimeControlStopRequestGraceTimeout {
  nanos: number;
  seconds: bigint;
}

export interface RuntimeControlStopRequest {
  completion: RuntimeShutdownCompletion;
  graceTimeout?: RuntimeControlStopRequestGraceTimeout;
  reason: string;
  target: RuntimeControlStopRequestTarget;
}

export type RuntimeControlStopOperationConflictField =
  | "completion"
  | "grace_timeout"
  | "reason"
  | "target.data_dir"
  | "target.launch_id"
  | "target.pid"
  | "target.supervisor_generation"
  | "target.supervisor_pid";

export interface RuntimeControlStopOperationConflict {
  actual: string;
  expected: string;
  field: RuntimeControlStopOperationConflictField;
  operationId: string;
}

export interface RuntimeControlStopOperationOutcome {
  disposition: RuntimeControlStopDisposition;
  operationId: string;
  request: RuntimeControlStopRequest;
  status: RuntimeControlStatusSnapshot;
  transition?: RuntimeControlTransition;
}

export interface RuntimeControlMachineState extends RuntimeControlStatusSnapshot {
  recentStopOperationOutcomes: readonly RuntimeControlStopOperationOutcome[];
  watchers: readonly RuntimeControlWatcher[];
}

export type RuntimeControlStopDisposition =
  | "accepted"
  | "already_finished"
  | "already_stopping";

export type RuntimeControlMachineEvent =
  | {
      occurredAt: Date;
      phase: RuntimeLifecyclePhase;
      reason: string;
      type: "lifecycle_transition_requested";
    }
  | {
      occurredAt: Date;
      reason: string;
      type: "lifecycle_release_succeeded";
    }
  | {
      message: string;
      occurredAt: Date;
      reason: string;
      type: "lifecycle_release_failed";
    }
  | {
      occurredAt: Date;
      operationId: string;
      request: RuntimeControlStopRequest;
      type: "stop_requested";
    }
  | {
      afterRuntimeSequence: bigint;
      id: number;
      type: "watch_registered";
    }
  | {
      id: number;
      type: "watch_closed";
    };

export type RuntimeControlMachineReduction =
  | {
      disposition: RuntimeControlStopDisposition;
      idempotentReplay: boolean;
      response: RuntimeControlStopOperationOutcome;
      state: RuntimeControlMachineState;
      transition?: RuntimeControlTransition;
      type: "stop";
    }
  | {
      conflict: RuntimeControlStopOperationConflict;
      idempotentReplay: false;
      state: RuntimeControlMachineState;
      type: "stop";
    }
  | {
      state: RuntimeControlMachineState;
      transition?: RuntimeControlTransition;
      type: "transition";
    }
  | {
      state: RuntimeControlMachineState;
      type: "watch";
    };

export function createInitialRuntimeControlState(input: {
  identity: RuntimeControlIdentity;
  now: Date;
}): RuntimeControlMachineState {
  return {
    identity: input.identity,
    phase: "starting",
    recentStopOperationOutcomes: [],
    runtimeSequence: 1n,
    updatedAt: input.now,
    watchers: [],
  };
}

const MAX_RECENT_STOP_OPERATION_OUTCOMES = 64;

export function reduceRuntimeControlMachine(
  state: RuntimeControlMachineState,
  event: RuntimeControlMachineEvent
): RuntimeControlMachineReduction {
  switch (event.type) {
    case "lifecycle_transition_requested": {
      const transition = createRuntimeControlTransition(state, {
        currentPhase: event.phase,
        occurredAt: event.occurredAt,
        reason: event.reason,
      });

      return {
        state: transition ? applyTransition(state, transition) : state,
        transition,
        type: "transition",
      };
    }
    case "lifecycle_release_succeeded": {
      const transition = createRuntimeControlTransition(state, {
        currentPhase: "stopped",
        occurredAt: event.occurredAt,
        reason: event.reason,
      });

      return {
        state: transition ? applyTransition(state, transition) : state,
        transition,
        type: "transition",
      };
    }
    case "lifecycle_release_failed": {
      const failure: RuntimeControlFailure = {
        code: "internal",
        message: event.message,
        retryable: false,
      };
      const transition = createRuntimeControlTransition(state, {
        currentPhase: "shutdown_failed",
        failure,
        occurredAt: event.occurredAt,
        reason: event.reason,
      });

      return {
        state: transition
          ? applyTransition(state, transition)
          : { ...state, failure, updatedAt: event.occurredAt },
        transition,
        type: "transition",
      };
    }
    case "stop_requested": {
      const existingOutcome = state.recentStopOperationOutcomes.find(
        (outcome) => outcome.operationId === event.operationId
      );
      if (existingOutcome) {
        const conflict = findStopOperationConflict({
          actual: event.request,
          expected: existingOutcome.request,
          operationId: event.operationId,
        });
        if (conflict) {
          return {
            conflict,
            idempotentReplay: false,
            state,
            type: "stop",
          };
        }

        return {
          disposition: existingOutcome.disposition,
          idempotentReplay: true,
          response: existingOutcome,
          state,
          type: "stop",
        };
      }

      if (isFinishedPhase(state.phase)) {
        const outcome = createStopOperationOutcome({
          disposition: "already_finished",
          operationId: event.operationId,
          request: event.request,
          state,
        });

        return {
          disposition: "already_finished",
          idempotentReplay: false,
          response: outcome,
          state: rememberStopOperationOutcome(state, outcome),
          type: "stop",
        };
      }

      if (isStoppingPhase(state.phase)) {
        const outcome = createStopOperationOutcome({
          disposition: "already_stopping",
          operationId: event.operationId,
          request: event.request,
          state,
        });

        return {
          disposition: "already_stopping",
          idempotentReplay: false,
          response: outcome,
          state: rememberStopOperationOutcome(state, outcome),
          type: "stop",
        };
      }

      const transition = createRuntimeControlTransition(state, {
        callerOperationId: event.operationId,
        currentPhase: "stopping",
        occurredAt: event.occurredAt,
        reason: event.request.reason,
      });
      const nextState = transition ? applyTransition(state, transition) : state;
      const outcome = createStopOperationOutcome({
        disposition: "accepted",
        operationId: event.operationId,
        request: event.request,
        state: nextState,
        transition,
      });

      return {
        disposition: "accepted",
        idempotentReplay: false,
        response: outcome,
        state: rememberStopOperationOutcome(nextState, outcome),
        transition,
        type: "stop",
      };
    }
    case "watch_registered":
      return {
        state: state.watchers.some((watcher) => watcher.id === event.id)
          ? state
          : {
              ...state,
              watchers: [
                ...state.watchers,
                {
                  afterRuntimeSequence: event.afterRuntimeSequence,
                  id: event.id,
                },
              ],
            },
        type: "watch",
      };
    case "watch_closed":
      return {
        state: {
          ...state,
          watchers: state.watchers.filter((watcher) => watcher.id !== event.id),
        },
        type: "watch",
      };
    default:
      return unreachable(event);
  }
}

function createStopOperationOutcome(input: {
  disposition: RuntimeControlStopDisposition;
  operationId: string;
  request: RuntimeControlStopRequest;
  state: RuntimeControlMachineState;
  transition?: RuntimeControlTransition;
}): RuntimeControlStopOperationOutcome {
  return {
    disposition: input.disposition,
    operationId: input.operationId,
    request: input.request,
    status: toRuntimeControlStatusSnapshot(input.state),
    transition: input.transition,
  };
}

function findStopOperationConflict(input: {
  actual: RuntimeControlStopRequest;
  expected: RuntimeControlStopRequest;
  operationId: string;
}): RuntimeControlStopOperationConflict | undefined {
  const targetConflict = findStopTargetConflict({
    actual: input.actual.target,
    expected: input.expected.target,
    operationId: input.operationId,
  });
  if (targetConflict) {
    return targetConflict;
  }

  if (input.actual.reason !== input.expected.reason) {
    return {
      actual: input.actual.reason,
      expected: input.expected.reason,
      field: "reason",
      operationId: input.operationId,
    };
  }

  if (input.actual.completion !== input.expected.completion) {
    return {
      actual: input.actual.completion,
      expected: input.expected.completion,
      field: "completion",
      operationId: input.operationId,
    };
  }

  if (
    !stopGraceTimeoutsEqual(
      input.actual.graceTimeout,
      input.expected.graceTimeout
    )
  ) {
    return {
      actual: formatStopGraceTimeout(input.actual.graceTimeout),
      expected: formatStopGraceTimeout(input.expected.graceTimeout),
      field: "grace_timeout",
      operationId: input.operationId,
    };
  }

  return undefined;
}

function findStopTargetConflict(input: {
  actual: RuntimeControlStopRequestTarget;
  expected: RuntimeControlStopRequestTarget;
  operationId: string;
}): RuntimeControlStopOperationConflict | undefined {
  if (input.actual.launchId !== input.expected.launchId) {
    return {
      actual: input.actual.launchId,
      expected: input.expected.launchId,
      field: "target.launch_id",
      operationId: input.operationId,
    };
  }

  if (input.actual.dataDir !== input.expected.dataDir) {
    return {
      actual: input.actual.dataDir,
      expected: input.expected.dataDir,
      field: "target.data_dir",
      operationId: input.operationId,
    };
  }

  return (
    findOptionalStopTargetFieldConflict({
      actual: input.actual.pid,
      expected: input.expected.pid,
      field: "target.pid",
      operationId: input.operationId,
    }) ??
    findOptionalStopTargetFieldConflict({
      actual: input.actual.supervisorPid,
      expected: input.expected.supervisorPid,
      field: "target.supervisor_pid",
      operationId: input.operationId,
    }) ??
    findOptionalStopTargetFieldConflict({
      actual: input.actual.supervisorGeneration,
      expected: input.expected.supervisorGeneration,
      field: "target.supervisor_generation",
      operationId: input.operationId,
    })
  );
}

function findOptionalStopTargetFieldConflict(input: {
  actual?: bigint | number;
  expected?: bigint | number;
  field: Extract<
    RuntimeControlStopOperationConflictField,
    "target.pid" | "target.supervisor_generation" | "target.supervisor_pid"
  >;
  operationId: string;
}): RuntimeControlStopOperationConflict | undefined {
  if (input.actual === input.expected) {
    return undefined;
  }

  return {
    actual: formatOptionalStopRequestValue(input.actual),
    expected: formatOptionalStopRequestValue(input.expected),
    field: input.field,
    operationId: input.operationId,
  };
}

function stopGraceTimeoutsEqual(
  actual: RuntimeControlStopRequestGraceTimeout | undefined,
  expected: RuntimeControlStopRequestGraceTimeout | undefined
): boolean {
  if (actual === undefined || expected === undefined) {
    return actual === expected;
  }

  return actual.seconds === expected.seconds && actual.nanos === expected.nanos;
}

function formatStopGraceTimeout(
  value: RuntimeControlStopRequestGraceTimeout | undefined
): string {
  return value ? `${value.seconds.toString()}s/${value.nanos}ns` : "unset";
}

function formatOptionalStopRequestValue(value: bigint | number | undefined) {
  return value === undefined ? "unset" : value.toString();
}

function rememberStopOperationOutcome(
  state: RuntimeControlMachineState,
  outcome: RuntimeControlStopOperationOutcome
): RuntimeControlMachineState {
  const outcomes = [
    outcome,
    ...state.recentStopOperationOutcomes.filter(
      (existing) => existing.operationId !== outcome.operationId
    ),
  ].slice(0, MAX_RECENT_STOP_OPERATION_OUTCOMES);

  return {
    ...state,
    recentStopOperationOutcomes: outcomes,
  };
}

function toRuntimeControlStatusSnapshot(
  state: RuntimeControlMachineState
): RuntimeControlStatusSnapshot {
  return {
    failure: state.failure,
    identity: state.identity,
    phase: state.phase,
    runtimeSequence: state.runtimeSequence,
    updatedAt: state.updatedAt,
  };
}

function createRuntimeControlTransition(
  state: RuntimeControlMachineState,
  input: {
    callerOperationId?: string;
    correlationId?: string;
    currentPhase: RuntimeControlPhase;
    failure?: RuntimeControlFailure;
    occurredAt: Date;
    reason: string;
  }
): RuntimeControlTransition | undefined {
  if (state.phase === input.currentPhase && state.failure === input.failure) {
    return undefined;
  }

  return {
    ...(input.callerOperationId
      ? { callerOperationId: input.callerOperationId }
      : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    currentPhase: input.currentPhase,
    failure: input.failure,
    occurredAt: input.occurredAt,
    previousPhase: state.phase,
    reason: input.reason,
    runtimeSequence: state.runtimeSequence + 1n,
    transitionId: createRuntimeTransitionId(state.runtimeSequence + 1n),
  };
}

function createRuntimeTransitionId(runtimeSequence: bigint): string {
  return `runtime:${runtimeSequence.toString()}`;
}

function applyTransition(
  state: RuntimeControlMachineState,
  transition: RuntimeControlTransition
): RuntimeControlMachineState {
  return {
    ...state,
    failure: transition.failure,
    phase: transition.currentPhase,
    runtimeSequence: transition.runtimeSequence,
    updatedAt: transition.occurredAt,
  };
}

function isFinishedPhase(phase: RuntimeControlPhase): boolean {
  switch (phase) {
    case "failed":
    case "shutdown_failed":
    case "stopped":
      return true;
    case "checkpointing":
    case "draining":
    case "ready":
    case "starting":
    case "stopping":
      return false;
    default:
      return unreachable(phase);
  }
}

function isStoppingPhase(phase: RuntimeControlPhase): boolean {
  switch (phase) {
    case "checkpointing":
    case "draining":
    case "stopping":
      return true;
    case "failed":
    case "ready":
    case "shutdown_failed":
    case "starting":
    case "stopped":
      return false;
    default:
      return unreachable(phase);
  }
}
