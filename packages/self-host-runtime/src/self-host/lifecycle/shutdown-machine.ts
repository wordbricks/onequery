import { unreachable } from "antiox/panic";
import type { OneshotSender } from "antiox/sync/oneshot";
import type { Result as ResultType } from "better-result";

import { createRuntimeShutdownError } from "./errors";
import type { RuntimeShutdownError } from "./errors";
import type {
  RuntimeShutdownCompletion,
  RuntimeShutdownRequest,
} from "./types";

export type ShutdownResult = ResultType<void, RuntimeShutdownError>;

export type ShutdownCompletion = RuntimeShutdownCompletion;

export type ShutdownMachineEvent =
  | {
      type: "controller_disposed";
    }
  | {
      request: RuntimeShutdownRequest;
      responseTx: OneshotSender<ShutdownResult>;
      type: "shutdown_requested";
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
      disposeRequested: boolean;
      request: RuntimeShutdownRequest;
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
      request: RuntimeShutdownRequest;
      type: "start_shutdown";
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
                request: event.request,
                type: "start_shutdown",
              },
            ],
            state: {
              status: "shutting_down",
              disposeRequested: false,
              request: event.request,
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
              request: mergeShutdownRequestCompletion(
                state.request,
                event.request
              ),
              responders: [...state.responders, event.responseTx],
            },
          };
        case "shutdown_finished": {
          const shouldExit = state.request.completion === "cleanup_and_exit";

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
            event.request.completion === "cleanup_and_exit" &&
            !state.exitHandled;

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
        default:
          return unreachable(event as never);
      }
    }
    default:
      return unreachable(state);
  }
}

export function createDisposedShutdownError(
  reason: string
): RuntimeShutdownError {
  return createRuntimeShutdownError({
    cause: null,
    code: "shutdown_rejected",
    message: `runtime shutdown controller is disposed for ${reason}`,
    reason,
  });
}

function mergeShutdownRequestCompletion(
  current: RuntimeShutdownRequest,
  next: RuntimeShutdownRequest
): RuntimeShutdownRequest {
  return {
    ...current,
    completion: mergeShutdownCompletion(current.completion, next.completion),
  };
}

function mergeShutdownCompletion(
  current: ShutdownCompletion,
  next: ShutdownCompletion
): ShutdownCompletion {
  return current === "cleanup_and_exit" || next === "cleanup_and_exit"
    ? "cleanup_and_exit"
    : "cleanup_only";
}
