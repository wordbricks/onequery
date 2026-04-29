import { isFieldSet } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  RuntimeFailureCode,
  RuntimePhase,
  RuntimeStatusSchema,
  RuntimeStopCompletion,
  RuntimeStopDisposition,
  RuntimeTransitionSchema,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import {
  GetStatusRequestSchema,
  RuntimeStopTargetSchema,
  RuntimeTargetSchema,
  StopRequestSchema,
  WatchStatusRequestSchema,
  WatchStatusResponseSchema,
} from "@onequery/proto-runtime/runtime/v1/control_pb";
import { unreachable } from "antiox/panic";
import { channel } from "antiox/sync/mpsc";
import type { Receiver, Sender } from "antiox/sync/mpsc";
import { oneshot } from "antiox/sync/oneshot";
import type { OneshotSender } from "antiox/sync/oneshot";
import { spawn } from "antiox/task";
import type { JoinHandle } from "antiox/task";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import { RuntimeShutdownError } from "../lifecycle/errors";
import type {
  GracefulShutdownController,
  RuntimeLifecycleFailure,
  RuntimeLifecycleDurableLease,
  RuntimeLifecycleLease,
  RuntimeLifecyclePhase,
  RuntimeLifecycleTransitionPersistence,
  RuntimeShutdownCompletion,
  RuntimeShutdownRequest,
} from "../lifecycle/types";
import {
  createInitialRuntimeControlState,
  isRuntimeControlTerminalPhase,
  reduceRuntimeControlMachine,
} from "./machine";
import type {
  RuntimeControlFailure,
  RuntimeControlIdentity,
  RuntimeControlMachineReduction,
  RuntimeControlMachineState,
  RuntimeControlPhase,
  RuntimeControlStatusSnapshot,
  RuntimeControlStopOperationConflict,
  RuntimeControlStopDisposition,
  RuntimeControlStopRequest,
  RuntimeControlTransition,
} from "./machine";

export class RuntimeControlActorError extends TaggedError(
  "RuntimeControlActorError"
)<{
  cause: unknown;
  message: string;
  operation: string;
}>() {}

export class RuntimeControlTargetPreconditionError extends TaggedError(
  "RuntimeControlTargetPreconditionError"
)<{
  actual: string;
  expected: string;
  field: string;
  message: string;
  operation: string;
}>() {}

export class RuntimeControlOperationConflictError extends TaggedError(
  "RuntimeControlOperationConflictError"
)<{
  actual: string;
  expected: string;
  field: string;
  message: string;
  operation: string;
  operationId: string;
}>() {}

type RuntimeStatusInit = MessageInitShape<typeof RuntimeStatusSchema>;
type RuntimeTransitionInit = MessageInitShape<typeof RuntimeTransitionSchema>;
type GetStatusRequestInit = MessageInitShape<typeof GetStatusRequestSchema>;
type RuntimeStopTargetInit = MessageInitShape<typeof RuntimeStopTargetSchema>;
type RuntimeTargetInit = MessageInitShape<typeof RuntimeTargetSchema>;
type StopRequestInit = MessageInitShape<typeof StopRequestSchema>;
type StopResponseInit = {
  disposition: RuntimeStopDisposition;
  status: RuntimeStatusInit;
  transition?: RuntimeTransitionInit;
};
type WatchStatusRequestInit = MessageInitShape<typeof WatchStatusRequestSchema>;
type WatchStatusResponseInit = MessageInitShape<
  typeof WatchStatusResponseSchema
>;

type RuntimeControlWatcherSubscription = {
  afterRuntimeSequence: bigint;
  eventTx: Sender<WatchStatusResponseInit>;
};

type RuntimeControlActorFailure =
  | RuntimeControlActorError
  | RuntimeControlOperationConflictError
  | RuntimeControlTargetPreconditionError;

type RuntimeControlActorResult<T> = ResultType<T, RuntimeControlActorFailure>;

type RuntimeControlActorMessage =
  | {
      target?: RuntimeTargetInit;
      responseTx: OneshotSender<RuntimeControlActorResult<RuntimeStatusInit>>;
      type: "get_status";
    }
  | {
      failure?: RuntimeLifecycleFailure;
      phase: RuntimeLifecyclePhase;
      reason: string;
      responseTx: OneshotSender<RuntimeControlActorResult<void>>;
      type: "transition";
    }
  | {
      reason: string;
      responseTx: OneshotSender<RuntimeControlActorResult<void>>;
      stopServer: boolean;
      type: "release";
    }
  | {
      request: StopRequestInit;
      responseTx: OneshotSender<RuntimeControlActorResult<StopResponseInit>>;
      type: "stop";
    }
  | {
      operationId: string;
      request: RuntimeControlStopRequest;
      type: "shutdown_timeout_elapsed";
    }
  | {
      afterRuntimeSequence: bigint;
      eventTx: Sender<WatchStatusResponseInit>;
      includeSnapshot: boolean;
      responseTx: OneshotSender<RuntimeControlActorResult<void>>;
      target?: RuntimeTargetInit;
      type: "watch_status";
      watcherId: number;
    }
  | {
      type: "close_watch";
      watcherId: number;
    }
  | {
      responseTx: OneshotSender<RuntimeControlActorResult<void>>;
      type: "close_all_watches";
    }
  | {
      type: "dispose";
    };

export interface RuntimeControlActor {
  attachShutdownController(controller: GracefulShutdownController): void;
  closeStatusWatches(): Promise<void>;
  dispose(): void;
  getStatus(
    target?: GetStatusRequestInit["target"]
  ): Promise<RuntimeStatusInit>;
  lease: RuntimeLifecycleLease;
  stop(request: StopRequestInit): Promise<StopResponseInit>;
  watchStatus(
    request: WatchStatusRequestInit,
    signal?: AbortSignal
  ): AsyncIterable<WatchStatusResponseInit>;
}

export function createRuntimeControlActor(input: {
  identity: RuntimeControlIdentity;
  lease: RuntimeLifecycleDurableLease;
  now?: () => Date;
}): RuntimeControlActor {
  const now = input.now ?? (() => new Date());
  const [eventTx, eventRx] = channel<RuntimeControlActorMessage>(64);
  const shutdownControllerRef: {
    current: GracefulShutdownController | null;
  } = {
    current: null,
  };
  const watcherRegistry = new Map<number, RuntimeControlWatcherSubscription>();
  let nextWatcherId = 1;

  const coordinatorTask = spawn(async (signal) => {
    await runRuntimeControlActor({
      eventRx,
      eventTx,
      initialState: createInitialRuntimeControlState({
        identity: input.identity,
        now: now(),
      }),
      lease: input.lease,
      now,
      shutdownControllerRef,
      signal,
      watcherRegistry,
    });
  });
  observeRuntimeControlActor(coordinatorTask);

  const request = async <T>(
    createMessage: (
      responseTx: OneshotSender<RuntimeControlActorResult<T>>
    ) => RuntimeControlActorMessage,
    operation: string
  ): Promise<T> => {
    const [responseTx, responseRx] = oneshot<RuntimeControlActorResult<T>>();
    const sendResult = await Result.tryPromise({
      try: () => eventTx.send(createMessage(responseTx)),
      catch: (cause) =>
        new RuntimeControlActorError({
          cause,
          message: `failed to send runtime control actor message for ${operation}`,
          operation,
        }),
    });
    if (sendResult.isErr()) {
      throw sendResult.error;
    }

    const result = await responseRx;
    if (result.isErr()) {
      throw result.error;
    }

    return result.value;
  };

  return {
    attachShutdownController(controller) {
      shutdownControllerRef.current = controller;
    },
    closeStatusWatches() {
      return request(
        (responseTx) => ({
          responseTx,
          type: "close_all_watches",
        }),
        "close_status_watches"
      );
    },
    dispose() {
      void Result.tryPromise({
        try: () =>
          eventTx.send({
            type: "dispose",
          }),
        catch: () => undefined,
      });
    },
    getStatus(target) {
      return request(
        (responseTx) => ({
          responseTx,
          target,
          type: "get_status",
        }),
        "get_status"
      );
    },
    lease: {
      paths: input.lease.paths,
      release({ reason, stopServer }) {
        return request(
          (responseTx) => ({
            reason,
            responseTx,
            stopServer,
            type: "release",
          }),
          "release"
        );
      },
      transition(phase, failure) {
        return request(
          (responseTx) => ({
            ...(failure ? { failure } : {}),
            phase,
            reason: `lifecycle:${phase}`,
            responseTx,
            type: "transition",
          }),
          "transition"
        );
      },
    },
    stop(stopRequest) {
      return request(
        (responseTx) => ({
          request: stopRequest,
          responseTx,
          type: "stop",
        }),
        "stop"
      );
    },
    watchStatus(watchRequest, signal) {
      const watcherId = nextWatcherId;
      nextWatcherId += 1;

      return watchRuntimeStatus({
        eventTx,
        request,
        signal,
        watcherId,
        watchRequest,
      });
    },
  };
}

async function runRuntimeControlActor(args: {
  eventRx: Receiver<RuntimeControlActorMessage>;
  eventTx: Sender<RuntimeControlActorMessage>;
  initialState: RuntimeControlMachineState;
  lease: RuntimeLifecycleDurableLease;
  now: () => Date;
  shutdownControllerRef: {
    current: GracefulShutdownController | null;
  };
  signal: AbortSignal;
  watcherRegistry: Map<number, RuntimeControlWatcherSubscription>;
}): Promise<void> {
  let state = args.initialState;

  while (!args.signal.aborted) {
    const message = await args.eventRx.recv(args.signal);
    if (message === null) {
      return;
    }

    switch (message.type) {
      case "get_status": {
        const targetResult = validateRuntimeTarget({
          operation: "get_status",
          required: false,
          state,
          target: message.target,
        });
        respond(
          message.responseTx,
          targetResult.isErr()
            ? Result.err(targetResult.error)
            : Result.ok(toRuntimeStatusInit(state))
        );
        break;
      }
      case "transition": {
        const result = await transitionLifecycleState({
          lease: args.lease,
          message,
          now: args.now,
          state,
        });
        if (result.isOk()) {
          state = await commitRuntimeControlReduction(
            result.value,
            args.watcherRegistry
          );
        }
        respond(
          message.responseTx,
          result.map(() => undefined)
        );
        break;
      }
      case "release": {
        const result = await releaseLifecycleLease({
          lease: args.lease,
          message,
          now: args.now,
          state,
        });
        state = await commitRuntimeControlReduction(
          result.reduction,
          args.watcherRegistry
        );
        respond(message.responseTx, result.result);
        break;
      }
      case "stop": {
        const result = await stopRuntime({
          eventTx: args.eventTx,
          lease: args.lease,
          message,
          now: args.now,
          shutdownController: args.shutdownControllerRef.current,
          state,
        });
        if (result.reduction) {
          state = await commitRuntimeControlReduction(
            result.reduction,
            args.watcherRegistry
          );
        }
        respond(message.responseTx, result.result);
        break;
      }
      case "shutdown_timeout_elapsed": {
        const result = await recordShutdownTimeout({
          lease: args.lease,
          message,
          now: args.now,
          state,
        });
        if (result.isOk()) {
          state = await commitRuntimeControlReduction(
            result.value,
            args.watcherRegistry
          );
        }
        break;
      }
      case "watch_status": {
        const targetResult = validateRuntimeTarget({
          operation: "watch_status",
          required: true,
          state,
          target: message.target,
        });
        if (targetResult.isErr()) {
          respond(message.responseTx, Result.err(targetResult.error));
          break;
        }
        args.watcherRegistry.set(message.watcherId, {
          afterRuntimeSequence: message.afterRuntimeSequence,
          eventTx: message.eventTx,
        });
        if (
          message.includeSnapshot &&
          state.runtimeSequence > message.afterRuntimeSequence
        ) {
          await sendWatchEvent(message.eventTx, {
            event: {
              case: "snapshot",
              value: toRuntimeStatusInit(state),
            },
          });
        }
        respond(message.responseTx, Result.ok(undefined));
        break;
      }
      case "close_watch": {
        args.watcherRegistry.delete(message.watcherId);
        break;
      }
      case "close_all_watches": {
        for (const watcher of args.watcherRegistry.values()) {
          watcher.eventTx.close();
        }
        args.watcherRegistry.clear();
        respond(message.responseTx, Result.ok(undefined));
        break;
      }
      case "dispose":
        for (const watcher of args.watcherRegistry.values()) {
          watcher.eventTx.close();
        }
        args.watcherRegistry.clear();
        args.eventRx.close();
        return;
      default:
        unreachable(message);
    }
  }
}

async function transitionLifecycleState(args: {
  lease: RuntimeLifecycleDurableLease;
  message: Extract<RuntimeControlActorMessage, { type: "transition" }>;
  now: () => Date;
  state: RuntimeControlMachineState;
}): Promise<
  ResultType<
    Extract<RuntimeControlMachineReduction, { type: "transition" }>,
    RuntimeControlActorError
  >
> {
  const reduction = reduceRuntimeControlMachine(args.state, {
    ...(args.message.failure ? { failure: args.message.failure } : {}),
    occurredAt: args.now(),
    phase: args.message.phase,
    reason: args.message.reason,
    type: "lifecycle_transition_requested",
  });
  if (reduction.type !== "transition") {
    throw new RuntimeControlActorError({
      cause: reduction,
      message: "runtime control reducer returned an invalid transition result",
      operation: "transition",
    });
  }

  const transition = reduction.transition;
  if (transition === undefined) {
    return Result.ok(reduction);
  }

  const persisted = await Result.tryPromise({
    try: () =>
      args.lease.persistTransition(
        toRuntimeLifecycleTransitionPersistence(transition)
      ),
    catch: (cause) =>
      new RuntimeControlActorError({
        cause,
        message: `failed to persist runtime lifecycle transition to ${args.message.phase}`,
        operation: "transition",
      }),
  });
  if (persisted.isErr()) {
    return Result.err(persisted.error);
  }

  return Result.ok(reduction);
}

async function recordShutdownTimeout(args: {
  lease: RuntimeLifecycleDurableLease;
  message: Extract<
    RuntimeControlActorMessage,
    { type: "shutdown_timeout_elapsed" }
  >;
  now: () => Date;
  state: RuntimeControlMachineState;
}): Promise<
  ResultType<
    Extract<RuntimeControlMachineReduction, { type: "transition" }>,
    RuntimeControlActorError
  >
> {
  if (args.message.request.graceTimeout === undefined) {
    return Result.ok({
      state: args.state,
      type: "transition",
    });
  }

  const reduction = reduceRuntimeControlMachine(args.state, {
    graceTimeout: args.message.request.graceTimeout,
    occurredAt: args.now(),
    operationId: args.message.operationId,
    reason: args.message.request.reason,
    type: "shutdown_timeout_elapsed",
  });
  if (reduction.type !== "transition") {
    throw new RuntimeControlActorError({
      cause: reduction,
      message:
        "runtime control reducer returned an invalid shutdown timeout result",
      operation: "shutdown_timeout_elapsed",
    });
  }

  const transition = reduction.transition;
  if (transition === undefined) {
    return Result.ok(reduction);
  }

  const persisted = await Result.tryPromise({
    try: () =>
      args.lease.persistTransition(
        toRuntimeLifecycleTransitionPersistence(transition)
      ),
    catch: (cause) =>
      new RuntimeControlActorError({
        cause,
        message: "failed to persist runtime shutdown timeout transition",
        operation: "shutdown_timeout_elapsed",
      }),
  });
  if (persisted.isErr()) {
    return Result.err(persisted.error);
  }

  return Result.ok(reduction);
}

async function releaseLifecycleLease(args: {
  lease: RuntimeLifecycleLease;
  message: Extract<RuntimeControlActorMessage, { type: "release" }>;
  now: () => Date;
  state: RuntimeControlMachineState;
}): Promise<{
  reduction: RuntimeControlMachineReduction;
  result: RuntimeControlActorResult<void>;
}> {
  // Comment: after a shutdown timeout, the original shutdown worker may still
  // finish and request release; terminal actor state must keep its durable
  // failure record for the supervisor to observe.
  if (isRuntimeControlTerminalPhase(args.state.phase)) {
    return {
      reduction: {
        state: args.state,
        type: "transition",
      },
      result: Result.ok(undefined),
    };
  }

  const released = await Result.tryPromise({
    try: () =>
      args.lease.release({
        reason: args.message.reason,
        stopServer: args.message.stopServer,
      }),
    catch: (cause) =>
      new RuntimeControlActorError({
        cause,
        message: `failed to release runtime lifecycle lease for ${args.message.reason}`,
        operation: "release",
      }),
  });

  if (released.isErr()) {
    return {
      reduction: reduceRuntimeControlMachine(args.state, {
        message: released.error.message,
        occurredAt: args.now(),
        reason: args.message.reason,
        type: "lifecycle_release_failed",
      }),
      result: Result.err(released.error),
    };
  }

  return {
    reduction: reduceRuntimeControlMachine(args.state, {
      occurredAt: args.now(),
      reason: args.message.reason,
      type: "lifecycle_release_succeeded",
    }),
    result: Result.ok(undefined),
  };
}

async function stopRuntime(args: {
  eventTx: Sender<RuntimeControlActorMessage>;
  lease: RuntimeLifecycleDurableLease;
  message: Extract<RuntimeControlActorMessage, { type: "stop" }>;
  now: () => Date;
  shutdownController: GracefulShutdownController | null;
  state: RuntimeControlMachineState;
}): Promise<{
  reduction?: RuntimeControlMachineReduction;
  result: RuntimeControlActorResult<StopResponseInit>;
}> {
  const targetResult = validateRuntimeStopTarget({
    operation: "stop",
    state: args.state,
    target: args.message.request.target,
  });
  if (targetResult.isErr()) {
    return {
      result: Result.err(targetResult.error),
    };
  }
  const target = targetResult.value;

  const completion = toRuntimeShutdownCompletion(
    args.message.request.completion ?? RuntimeStopCompletion.UNSPECIFIED
  );
  const requestReason = args.message.request.reason ?? "";
  const reason =
    requestReason.trim().length > 0 ? requestReason : "runtime_control_stop";
  const operationId = args.message.request.operationId;
  if (!operationId) {
    return {
      result: Result.err(
        new RuntimeControlActorError({
          cause: null,
          message: "runtime control stop request operation_id is required",
          operation: "stop",
        })
      ),
    };
  }
  const request = createRuntimeControlStopRequest({
    completion,
    graceTimeout: args.message.request.graceTimeout,
    reason,
    target,
  });

  const occurredAt = args.now();
  const reduction = reduceRuntimeControlMachine(args.state, {
    occurredAt,
    operationId,
    request,
    type: "stop_requested",
  });
  if (reduction.type !== "stop") {
    throw new RuntimeControlActorError({
      cause: reduction,
      message: "runtime control reducer returned an invalid stop result",
      operation: "stop",
    });
  }
  if ("conflict" in reduction) {
    return {
      result: Result.err(
        toRuntimeControlOperationConflictError(reduction.conflict)
      ),
    };
  }

  const shouldStartShutdown =
    reduction.disposition === "accepted" && !reduction.idempotentReplay;
  let shutdownController: GracefulShutdownController | null = null;
  if (shouldStartShutdown) {
    if (!args.shutdownController) {
      return {
        result: Result.err(
          new RuntimeControlActorError({
            cause: null,
            message: "runtime shutdown controller is not attached",
            operation: "stop",
          })
        ),
      };
    }
    shutdownController = args.shutdownController;
  }

  const transition = reduction.transition;
  if (transition !== undefined) {
    const persisted = await Result.tryPromise({
      try: () =>
        args.lease.persistTransition(
          toRuntimeLifecycleTransitionPersistence(transition)
        ),
      catch: (cause) =>
        new RuntimeControlActorError({
          cause,
          message: "failed to persist runtime stop transition",
          operation: "stop",
        }),
    });
    if (persisted.isErr()) {
      return {
        result: Result.err(persisted.error),
      };
    }
  }

  if (shutdownController) {
    observeRuntimeShutdown({
      eventTx: args.eventTx,
      operationId,
      request,
      shutdown: shutdownController.shutdown(
        toRuntimeShutdownRequest({
          operationId,
          request,
        })
      ),
    });
  }

  return {
    reduction,
    result: Result.ok({
      disposition: toProtoStopDisposition(reduction.response.disposition),
      status: toRuntimeStatusInit(reduction.response.status),
      transition: reduction.response.transition
        ? toRuntimeTransitionInit(reduction.response.transition)
        : undefined,
    }),
  };
}

function toRuntimeLifecycleTransitionPersistence(
  transition: RuntimeControlTransition
): RuntimeLifecycleTransitionPersistence {
  return {
    ...(transition.failure ? { failure: transition.failure } : {}),
    occurredAt: transition.occurredAt,
    phase: toRuntimeLifecyclePhase(transition.currentPhase),
    runtimeSequence: transition.runtimeSequence,
  };
}

function toRuntimeLifecyclePhase(
  phase: RuntimeControlPhase
): RuntimeLifecyclePhase {
  switch (phase) {
    case "checkpointing":
    case "draining":
    case "ready":
    case "shutdown_failed":
    case "starting":
    case "stopping":
      return phase;
    case "failed":
    case "stopped":
      throw new RuntimeControlActorError({
        cause: null,
        message: `runtime phase ${phase} is not persisted by runtime lease transitions`,
        operation: "transition",
      });
    default:
      return unreachable(phase);
  }
}

function createRuntimeControlStopRequest(input: {
  completion: RuntimeShutdownCompletion;
  graceTimeout: StopRequestInit["graceTimeout"];
  reason: string;
  target: RuntimeStopTargetInit;
}): RuntimeControlStopRequest {
  return {
    completion: input.completion,
    graceTimeout: input.graceTimeout
      ? {
          nanos: input.graceTimeout.nanos ?? 0,
          seconds: input.graceTimeout.seconds ?? 0n,
        }
      : undefined,
    reason: input.reason,
    target: createRuntimeControlStopRequestTarget(input.target),
  };
}

function toRuntimeShutdownRequest(input: {
  operationId: string;
  request: RuntimeControlStopRequest;
}): RuntimeShutdownRequest {
  return {
    completion: input.request.completion,
    ...(input.request.graceTimeout
      ? {
          graceTimeout: {
            nanos: input.request.graceTimeout.nanos,
            seconds: input.request.graceTimeout.seconds,
          },
        }
      : {}),
    operationId: input.operationId,
    reason: input.request.reason,
    target: {
      ...input.request.target,
    },
  };
}

function createRuntimeControlStopRequestTarget(
  target: RuntimeStopTargetInit
): RuntimeControlStopRequest["target"] {
  const supervisor = target.supervisor ?? {
    generation: 0n,
    pid: 0,
    supervisorId: "",
  };

  return {
    dataDir: target.dataDir ?? "",
    launchId: target.launchId ?? "",
    pid: target.pid ?? 0,
    supervisor: {
      generation: supervisor.generation ?? 0n,
      pid: supervisor.pid ?? 0,
      supervisorId: supervisor.supervisorId ?? "",
    },
  };
}

function toRuntimeControlOperationConflictError(
  conflict: RuntimeControlStopOperationConflict
): RuntimeControlOperationConflictError {
  return new RuntimeControlOperationConflictError({
    actual: conflict.actual,
    expected: conflict.expected,
    field: conflict.field,
    message: `runtime control stop request operation_id ${conflict.operationId} was already used with a different ${conflict.field}: expected ${conflict.expected}, got ${conflict.actual}`,
    operation: "stop",
    operationId: conflict.operationId,
  });
}

function validateRuntimeTarget(args: {
  operation: string;
  required: true;
  state: RuntimeControlMachineState;
  target?: RuntimeTargetInit;
}): ResultType<RuntimeTargetInit, RuntimeControlTargetPreconditionError>;
function validateRuntimeTarget(args: {
  operation: string;
  required: false;
  state: RuntimeControlMachineState;
  target?: RuntimeTargetInit;
}): ResultType<
  RuntimeTargetInit | undefined,
  RuntimeControlTargetPreconditionError
>;
function validateRuntimeTarget(args: {
  operation: string;
  required: boolean;
  state: RuntimeControlMachineState;
  target?: RuntimeTargetInit;
}): ResultType<
  RuntimeTargetInit | undefined,
  RuntimeControlTargetPreconditionError
> {
  if (args.target === undefined) {
    return args.required
      ? Result.err(
          new RuntimeControlTargetPreconditionError({
            actual: "missing",
            expected: "present",
            field: "target",
            message: `runtime control ${args.operation} request target is required`,
            operation: args.operation,
          })
        )
      : Result.ok(undefined);
  }

  const expected = {
    dataDir: args.state.identity.dataDir,
    launchId: args.state.identity.launchId,
    pid: args.state.identity.pid,
  };
  const mismatchedField = findRuntimeTargetMismatch(args.target, expected);

  if (mismatchedField === undefined) {
    return Result.ok(args.target);
  }

  return Result.err(
    new RuntimeControlTargetPreconditionError({
      actual: mismatchedField.actual,
      expected: mismatchedField.expected,
      field: mismatchedField.field,
      message: `runtime control ${args.operation} target ${mismatchedField.field} mismatch: expected ${mismatchedField.expected}, got ${mismatchedField.actual}`,
      operation: args.operation,
    })
  );
}

function validateRuntimeStopTarget(args: {
  operation: string;
  state: RuntimeControlMachineState;
  target?: RuntimeStopTargetInit;
}): ResultType<RuntimeStopTargetInit, RuntimeControlTargetPreconditionError> {
  if (args.target === undefined) {
    return Result.err(
      new RuntimeControlTargetPreconditionError({
        actual: "missing",
        expected: "present",
        field: "target",
        message: `runtime control ${args.operation} request target is required`,
        operation: args.operation,
      })
    );
  }

  const expected = {
    dataDir: args.state.identity.dataDir,
    launchId: args.state.identity.launchId,
    pid: args.state.identity.pid,
    supervisor: args.state.identity.supervisor,
  };
  const mismatchedField = findRuntimeStopTargetMismatch(args.target, expected);

  if (mismatchedField === undefined) {
    return Result.ok(args.target);
  }

  return Result.err(
    new RuntimeControlTargetPreconditionError({
      actual: mismatchedField.actual,
      expected: mismatchedField.expected,
      field: mismatchedField.field,
      message: `runtime control ${args.operation} target ${mismatchedField.field} mismatch: expected ${mismatchedField.expected}, got ${mismatchedField.actual}`,
      operation: args.operation,
    })
  );
}

function findRuntimeTargetMismatch(
  target: RuntimeTargetInit,
  expected: {
    dataDir: string;
    launchId: string;
    pid: number;
  }
):
  | {
      actual: string;
      expected: string;
      field: string;
    }
  | undefined {
  const actualLaunchId = target.launchId ?? "";
  if (actualLaunchId !== expected.launchId) {
    return {
      actual: actualLaunchId,
      expected: expected.launchId,
      field: "launch_id",
    };
  }

  const actualDataDir = target.dataDir ?? "";
  if (actualDataDir !== expected.dataDir) {
    return {
      actual: actualDataDir,
      expected: expected.dataDir,
      field: "data_dir",
    };
  }

  const actualPid = target.pid;
  if (runtimeTargetFieldIsSet(target, "pid") && actualPid !== expected.pid) {
    return {
      actual: actualPid?.toString() ?? "unset",
      expected: expected.pid.toString(),
      field: "pid",
    };
  }

  return undefined;
}

function findRuntimeStopTargetMismatch(
  target: RuntimeStopTargetInit,
  expected: {
    dataDir: string;
    launchId: string;
    pid: number;
    supervisor: RuntimeControlIdentity["supervisor"];
  }
):
  | {
      actual: string;
      expected: string;
      field: string;
    }
  | undefined {
  const actualLaunchId = target.launchId ?? "";
  if (actualLaunchId !== expected.launchId) {
    return {
      actual: actualLaunchId,
      expected: expected.launchId,
      field: "launch_id",
    };
  }

  const actualDataDir = target.dataDir ?? "";
  if (actualDataDir !== expected.dataDir) {
    return {
      actual: actualDataDir,
      expected: expected.dataDir,
      field: "data_dir",
    };
  }

  const actualPid = target.pid ?? 0;
  if (actualPid !== expected.pid) {
    return {
      actual: actualPid.toString(),
      expected: expected.pid.toString(),
      field: "pid",
    };
  }

  const actualSupervisor = target.supervisor;
  if (actualSupervisor === undefined) {
    return {
      actual: "missing",
      expected: "present",
      field: "supervisor",
    };
  }

  const actualSupervisorId = actualSupervisor.supervisorId ?? "";
  if (actualSupervisorId !== expected.supervisor.supervisorId) {
    return {
      actual: actualSupervisorId,
      expected: expected.supervisor.supervisorId,
      field: "supervisor.supervisor_id",
    };
  }

  const actualSupervisorPid = actualSupervisor.pid ?? 0;
  if (actualSupervisorPid !== expected.supervisor.pid) {
    return {
      actual: actualSupervisorPid.toString(),
      expected: expected.supervisor.pid.toString(),
      field: "supervisor.pid",
    };
  }

  const actualSupervisorGeneration = actualSupervisor.generation ?? 0n;
  if (actualSupervisorGeneration !== expected.supervisor.generation) {
    return {
      actual: actualSupervisorGeneration.toString(),
      expected: expected.supervisor.generation.toString(),
      field: "supervisor.generation",
    };
  }

  return undefined;
}

function runtimeTargetFieldIsSet(
  target: RuntimeTargetInit,
  field: "pid"
): boolean {
  if (isRuntimeTargetMessage(target)) {
    return isFieldSet(target, RuntimeTargetSchema.field[field]);
  }

  return target[field] !== undefined;
}

function isRuntimeTargetMessage(
  target: RuntimeTargetInit
): target is RuntimeTargetInit & { $typeName: string } {
  return "$typeName" in target;
}

async function commitRuntimeControlReduction(
  reduction: RuntimeControlMachineReduction,
  watcherRegistry: Map<number, RuntimeControlWatcherSubscription>
): Promise<RuntimeControlMachineState> {
  const transition =
    "transition" in reduction ? reduction.transition : undefined;
  if (transition === undefined) {
    return reduction.state;
  }

  const staleWatcherIds: number[] = [];
  const event = {
    event: {
      case: "transition",
      value: toRuntimeTransitionInit(transition),
    },
  } satisfies WatchStatusResponseInit;

  for (const [watcherId, watcher] of watcherRegistry) {
    if (transition.runtimeSequence <= watcher.afterRuntimeSequence) {
      continue;
    }

    const sent = await sendWatchEvent(watcher.eventTx, event);
    if (sent.isErr()) {
      staleWatcherIds.push(watcherId);
    }
  }

  if (staleWatcherIds.length === 0) {
    return reduction.state;
  }

  for (const watcherId of staleWatcherIds) {
    watcherRegistry.delete(watcherId);
  }

  return reduction.state;
}

async function sendWatchEvent(
  eventTx: Sender<WatchStatusResponseInit>,
  event: WatchStatusResponseInit
): Promise<ResultType<void, RuntimeControlActorError>> {
  return Result.tryPromise({
    try: async () => {
      await eventTx.send(event);
    },
    catch: (cause) =>
      new RuntimeControlActorError({
        cause,
        message: "failed to send runtime status watch event",
        operation: "watch_status",
      }),
  });
}

async function* watchRuntimeStatus(args: {
  eventTx: Sender<RuntimeControlActorMessage>;
  request: <T>(
    createMessage: (
      responseTx: OneshotSender<RuntimeControlActorResult<T>>
    ) => RuntimeControlActorMessage,
    operation: string
  ) => Promise<T>;
  signal?: AbortSignal;
  watcherId: number;
  watchRequest: WatchStatusRequestInit;
}): AsyncIterable<WatchStatusResponseInit> {
  const [watchTx, watchRx] = channel<WatchStatusResponseInit>(16);

  await args.request(
    (responseTx) => ({
      afterRuntimeSequence: args.watchRequest.afterRuntimeSequence ?? 0n,
      eventTx: watchTx,
      includeSnapshot: args.watchRequest.includeSnapshot ?? false,
      responseTx,
      target: args.watchRequest.target,
      type: "watch_status",
      watcherId: args.watcherId,
    }),
    "watch_status"
  );

  try {
    while (!args.signal?.aborted) {
      const event = await watchRx.recv(args.signal);
      if (event === null) {
        return;
      }

      yield event;
    }
  } finally {
    watchTx.close();
    watchRx.close();
    void Result.tryPromise({
      try: () =>
        args.eventTx.send({
          type: "close_watch",
          watcherId: args.watcherId,
        }),
      catch: () => undefined,
    });
  }
}

const MAX_RUNTIME_CONTROL_GRACE_TIMEOUT_MS = 300_000;

function observeRuntimeShutdown(args: {
  eventTx: Sender<RuntimeControlActorMessage>;
  operationId: string;
  request: RuntimeControlStopRequest;
  shutdown: Promise<void>;
}): void {
  let timedOut = false;
  const timeoutMs = runtimeControlGraceTimeoutMs(args.request.graceTimeout);
  const timeoutId =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          void Result.tryPromise({
            try: () =>
              args.eventTx.send({
                operationId: args.operationId,
                request: args.request,
                type: "shutdown_timeout_elapsed",
              }),
            catch: () => undefined,
          });
        }, timeoutMs);

  void Result.tryPromise({
    try: async () => {
      await args.shutdown;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    },
    catch: async (cause) => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (timedOut) {
        return;
      }

      await Result.tryPromise({
        try: () =>
          args.eventTx.send({
            failure: runtimeShutdownFailureFromCause(
              cause,
              args.request.reason
            ),
            phase: "shutdown_failed",
            reason: args.request.reason,
            responseTx: oneshot<RuntimeControlActorResult<void>>()[0],
            type: "transition",
          }),
        catch: () => undefined,
      });
    },
  });
}

function runtimeShutdownFailureFromCause(
  cause: unknown,
  reason: string
): RuntimeControlFailure {
  if (cause instanceof RuntimeShutdownError) {
    return cause.failure;
  }

  return {
    code: "internal",
    message: `runtime shutdown failed for ${reason}`,
    retryable: false,
  };
}

function runtimeControlGraceTimeoutMs(
  timeout: RuntimeControlStopRequest["graceTimeout"]
): number | undefined {
  if (timeout === undefined) {
    return undefined;
  }

  const seconds = timeout.seconds > 0n ? timeout.seconds : 0n;
  const secondsMs =
    seconds > BigInt(MAX_RUNTIME_CONTROL_GRACE_TIMEOUT_MS / 1000)
      ? MAX_RUNTIME_CONTROL_GRACE_TIMEOUT_MS
      : Number(seconds) * 1000;
  const nanosMs = timeout.nanos > 0 ? Math.ceil(timeout.nanos / 1_000_000) : 0;

  return Math.min(MAX_RUNTIME_CONTROL_GRACE_TIMEOUT_MS, secondsMs + nanosMs);
}

function observeRuntimeControlActor(handle: JoinHandle<void>): void {
  void Result.tryPromise({
    try: async () => {
      await handle;
    },
    catch: () => undefined,
  });
}

function respond<T>(
  responseTx: OneshotSender<RuntimeControlActorResult<T>>,
  result: RuntimeControlActorResult<T>
): void {
  Result.try(() => responseTx.send(result));
}

function toRuntimeStatusInit(
  state: RuntimeControlStatusSnapshot
): RuntimeStatusInit {
  return {
    failure: state.failure ? toRuntimeFailureInit(state.failure) : undefined,
    identity: {
      dataDir: state.identity.dataDir,
      launchId: state.identity.launchId,
      pid: state.identity.pid,
    },
    phase: toProtoPhase(state.phase),
    runtimeSequence: state.runtimeSequence,
    updatedAt: timestampFromDate(state.updatedAt),
  };
}

function toRuntimeTransitionInit(
  transition: RuntimeControlTransition
): RuntimeTransitionInit {
  return {
    ...(transition.callerOperationId
      ? { callerOperationId: transition.callerOperationId }
      : {}),
    ...(transition.correlationId
      ? { correlationId: transition.correlationId }
      : {}),
    currentPhase: toProtoPhase(transition.currentPhase),
    failure: transition.failure
      ? toRuntimeFailureInit(transition.failure)
      : undefined,
    occurredAt: timestampFromDate(transition.occurredAt),
    previousPhase: toProtoPhase(transition.previousPhase),
    reason: transition.reason,
    runtimeSequence: transition.runtimeSequence,
    transitionId: transition.transitionId,
  };
}

function toRuntimeFailureInit(failure: RuntimeControlFailure) {
  return {
    code: toProtoFailureCode(failure.code),
    message: failure.message,
    retryable: failure.retryable,
  };
}

function toRuntimeShutdownCompletion(
  value: RuntimeStopCompletion
): RuntimeShutdownCompletion {
  switch (value) {
    case RuntimeStopCompletion.CLEANUP_ONLY:
      return "cleanup_only";
    case RuntimeStopCompletion.CLEANUP_AND_EXIT:
    case RuntimeStopCompletion.UNSPECIFIED:
      return "cleanup_and_exit";
    default:
      return unreachable(value);
  }
}

function toProtoStopDisposition(
  value: RuntimeControlStopDisposition
): RuntimeStopDisposition {
  switch (value) {
    case "accepted":
      return RuntimeStopDisposition.ACCEPTED;
    case "already_finished":
      return RuntimeStopDisposition.ALREADY_FINISHED;
    case "already_stopping":
      return RuntimeStopDisposition.ALREADY_STOPPING;
    default:
      return unreachable(value);
  }
}

function toProtoPhase(phase: RuntimeControlPhase) {
  switch (phase) {
    case "checkpointing":
      return RuntimePhase.CHECKPOINTING;
    case "draining":
      return RuntimePhase.DRAINING;
    case "failed":
      return RuntimePhase.FAILED;
    case "ready":
      return RuntimePhase.READY;
    case "shutdown_failed":
      return RuntimePhase.SHUTDOWN_FAILED;
    case "starting":
      return RuntimePhase.STARTING;
    case "stopped":
      return RuntimePhase.STOPPED;
    case "stopping":
      return RuntimePhase.STOPPING;
    default:
      return unreachable(phase);
  }
}

function toProtoFailureCode(code: RuntimeControlFailure["code"]) {
  switch (code) {
    case "checkpoint_failed":
      return RuntimeFailureCode.CHECKPOINT_FAILED;
    case "internal":
      return RuntimeFailureCode.INTERNAL;
    case "resource_close_failed":
      return RuntimeFailureCode.RESOURCE_CLOSE_FAILED;
    case "shutdown_rejected":
      return RuntimeFailureCode.SHUTDOWN_REJECTED;
    case "shutdown_timeout":
      return RuntimeFailureCode.SHUTDOWN_TIMEOUT;
    default:
      return unreachable(code);
  }
}
