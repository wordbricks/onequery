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
}

export interface RuntimeControlFailure {
  code: RuntimeControlFailureCode;
  message: string;
  retryable: boolean;
}

export interface RuntimeControlOperation {
  name: "lifecycle" | "release" | "stop";
  operationId: string;
}

export interface RuntimeControlTransition {
  currentPhase: RuntimeControlPhase;
  failure?: RuntimeControlFailure;
  occurredAt: Date;
  operation?: RuntimeControlOperation;
  previousPhase: RuntimeControlPhase;
  reason: string;
  sequence: bigint;
}

export interface RuntimeControlWatcher {
  afterSequence: bigint;
  id: number;
}

export interface RuntimeControlMachineState {
  failure?: RuntimeControlFailure;
  identity: RuntimeControlIdentity;
  phase: RuntimeControlPhase;
  sequence: bigint;
  updatedAt: Date;
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
      completion: RuntimeShutdownCompletion;
      occurredAt: Date;
      operationId: string;
      reason: string;
      type: "stop_requested";
    }
  | {
      afterSequence: bigint;
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
      state: RuntimeControlMachineState;
      transition?: RuntimeControlTransition;
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
    sequence: 1n,
    updatedAt: input.now,
    watchers: [],
  };
}

export function reduceRuntimeControlMachine(
  state: RuntimeControlMachineState,
  event: RuntimeControlMachineEvent
): RuntimeControlMachineReduction {
  switch (event.type) {
    case "lifecycle_transition_requested": {
      const transition = createRuntimeControlTransition(state, {
        currentPhase: event.phase,
        occurredAt: event.occurredAt,
        operation: {
          name: "lifecycle",
          operationId: `lifecycle:${event.phase}:${event.occurredAt.toISOString()}`,
        },
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
        operation: {
          name: "release",
          operationId: `release:${event.reason}:${event.occurredAt.toISOString()}`,
        },
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
        operation: {
          name: "release",
          operationId: `release_failed:${event.reason}:${event.occurredAt.toISOString()}`,
        },
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
      if (isFinishedPhase(state.phase)) {
        return {
          disposition: "already_finished",
          state,
          type: "stop",
        };
      }

      if (isStoppingPhase(state.phase)) {
        return {
          disposition: "already_stopping",
          state,
          type: "stop",
        };
      }

      const transition = createRuntimeControlTransition(state, {
        currentPhase: "stopping",
        occurredAt: event.occurredAt,
        operation: {
          name: "stop",
          operationId: event.operationId,
        },
        reason: event.reason,
      });

      return {
        disposition: "accepted",
        state: transition ? applyTransition(state, transition) : state,
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
                  afterSequence: event.afterSequence,
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

function createRuntimeControlTransition(
  state: RuntimeControlMachineState,
  input: {
    currentPhase: RuntimeControlPhase;
    failure?: RuntimeControlFailure;
    occurredAt: Date;
    operation?: RuntimeControlOperation;
    reason: string;
  }
): RuntimeControlTransition | undefined {
  if (state.phase === input.currentPhase && state.failure === input.failure) {
    return undefined;
  }

  return {
    currentPhase: input.currentPhase,
    failure: input.failure,
    occurredAt: input.occurredAt,
    operation: input.operation,
    previousPhase: state.phase,
    reason: input.reason,
    sequence: state.sequence + 1n,
  };
}

function applyTransition(
  state: RuntimeControlMachineState,
  transition: RuntimeControlTransition
): RuntimeControlMachineState {
  return {
    ...state,
    failure: transition.failure,
    phase: transition.currentPhase,
    sequence: transition.sequence,
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
