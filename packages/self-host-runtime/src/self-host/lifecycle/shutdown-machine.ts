import { unreachable } from "antiox/panic";
import type { OneshotSender } from "antiox/sync/oneshot";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import { RuntimeShutdownError } from "./errors";
import type { RuntimeShutdownCompletion } from "./types";

export type ShutdownResult = ResultType<void, RuntimeShutdownError>;

export type ShutdownCompletion = RuntimeShutdownCompletion;

export type ShutdownMachineEvent =
  | {
      type: "controller_disposed";
    }
  | {
      type: "shutdown_requested";
      completion: ShutdownCompletion;
      reason: string;
      responseTx: OneshotSender<ShutdownResult>;
    }
  | {
      type: "shutdown_finished";
      result: ShutdownResult;
    };

export type ShutdownMachineState =
  | {
      status: "idle";
    }
  | {
      status: "shutting_down";
      completion: ShutdownCompletion;
      disposeRequested: boolean;
      reason: string;
      responders: readonly OneshotSender<ShutdownResult>[];
    }
  | {
      status: "finished";
      exitHandled: boolean;
      result: ShutdownResult;
    }
  | {
      status: "disposed";
    };

export type ShutdownMachineEffect =
  | {
      type: "close_event_receiver";
    }
  | {
      type: "exit";
      code: 0 | 1;
    }
  | {
      type: "respond";
      responders: readonly OneshotSender<ShutdownResult>[];
      result: ShutdownResult;
    }
  | {
      type: "start_shutdown";
      reason: string;
    };

export const initialShutdownMachineState: ShutdownMachineState = {
  status: "idle",
};

export function reduceShutdownMachine(
  state: ShutdownMachineState,
  event: ShutdownMachineEvent
): {
  effects: ShutdownMachineEffect[];
  state: ShutdownMachineState;
} {
  switch (state.status) {
    case "idle": {
      switch (event.type) {
        case "controller_disposed":
          return {
            effects: [
              {
                type: "close_event_receiver",
              },
            ],
            state: {
              status: "disposed",
            },
          };
        case "shutdown_requested":
          return {
            effects: [
              {
                type: "start_shutdown",
                reason: event.reason,
              },
            ],
            state: {
              status: "shutting_down",
              completion: event.completion,
              disposeRequested: false,
              reason: event.reason,
              responders: [event.responseTx],
            },
          };
        case "shutdown_finished":
          return {
            effects: [],
            state,
          };
        default:
          return unreachable(event);
      }
    }
    case "shutting_down": {
      switch (event.type) {
        case "controller_disposed":
          return {
            effects: [],
            state: {
              ...state,
              disposeRequested: true,
            },
          };
        case "shutdown_requested":
          return {
            effects: [],
            state: {
              ...state,
              completion: mergeShutdownCompletion(
                state.completion,
                event.completion
              ),
              responders: [...state.responders, event.responseTx],
            },
          };
        case "shutdown_finished": {
          const shouldExit = state.completion === "cleanup_and_exit";

          return {
            effects: [
              {
                type: "respond",
                responders: state.responders,
                result: event.result,
              },
              ...(shouldExit
                ? [
                    {
                      type: "exit",
                      code: event.result.isOk() ? 0 : 1,
                    } satisfies ShutdownMachineEffect,
                  ]
                : []),
              ...(state.disposeRequested
                ? [
                    {
                      type: "close_event_receiver",
                    } satisfies ShutdownMachineEffect,
                  ]
                : []),
            ],
            state: state.disposeRequested
              ? {
                  status: "disposed",
                }
              : {
                  status: "finished",
                  exitHandled: shouldExit,
                  result: event.result,
                },
          };
        }
        default:
          return unreachable(event);
      }
    }
    case "finished": {
      switch (event.type) {
        case "controller_disposed":
          return {
            effects: [
              {
                type: "close_event_receiver",
              },
            ],
            state: {
              status: "disposed",
            },
          };
        case "shutdown_requested": {
          const shouldExit =
            event.completion === "cleanup_and_exit" && !state.exitHandled;

          return {
            effects: [
              {
                type: "respond",
                responders: [event.responseTx],
                result: state.result,
              },
              ...(shouldExit
                ? [
                    {
                      type: "exit",
                      code: state.result.isOk() ? 0 : 1,
                    } satisfies ShutdownMachineEffect,
                  ]
                : []),
            ],
            state: {
              ...state,
              exitHandled: state.exitHandled || shouldExit,
            },
          };
        }
        case "shutdown_finished":
          return {
            effects: [],
            state,
          };
        default:
          return unreachable(event);
      }
    }
    case "disposed": {
      switch (event.type) {
        case "controller_disposed":
        case "shutdown_finished":
          return {
            effects: [],
            state,
          };
        case "shutdown_requested":
          return {
            effects: [
              {
                type: "respond",
                responders: [event.responseTx],
                result: Result.err(createDisposedShutdownError(event.reason)),
              },
            ],
            state,
          };
        default:
          return unreachable(event);
      }
    }
    default:
      return unreachable(state);
  }
}

export function createDisposedShutdownError(
  reason: string
): RuntimeShutdownError {
  return new RuntimeShutdownError({
    cause: null,
    message: `runtime shutdown controller is disposed for ${reason}`,
    reason,
  });
}

function mergeShutdownCompletion(
  current: ShutdownCompletion,
  next: ShutdownCompletion
): ShutdownCompletion {
  return current === "cleanup_and_exit" || next === "cleanup_and_exit"
    ? "cleanup_and_exit"
    : "cleanup_only";
}
