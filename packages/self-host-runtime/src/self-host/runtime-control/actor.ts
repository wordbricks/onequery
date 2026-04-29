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

import type {
  GracefulShutdownController,
  RuntimeLifecycleLease,
  RuntimeLifecyclePhase,
  RuntimeShutdownCompletion,
} from "../lifecycle/types";
import {
  createInitialRuntimeControlState,
  reduceRuntimeControlMachine,
} from "./machine";
import type {
  RuntimeControlFailure,
  RuntimeControlIdentity,
  RuntimeControlMachineReduction,
  RuntimeControlMachineState,
  RuntimeControlPhase,
  RuntimeControlStopDisposition,
  RuntimeControlTransition,
} from "./machine";

export class RuntimeControlActorError extends TaggedError(
  "RuntimeControlActorError"
)<{
  cause: unknown;
  message: string;
  operation: string;
}>() {}

type RuntimeStatusInit = MessageInitShape<typeof RuntimeStatusSchema>;
type RuntimeTransitionInit = MessageInitShape<typeof RuntimeTransitionSchema>;
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

type RuntimeControlActorResult<T> = ResultType<T, RuntimeControlActorError>;

type RuntimeControlActorMessage =
  | {
      responseTx: OneshotSender<RuntimeControlActorResult<RuntimeStatusInit>>;
      type: "get_status";
    }
  | {
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
      afterSequence: bigint;
      eventTx: Sender<WatchStatusResponseInit>;
      includeSnapshot: boolean;
      responseTx: OneshotSender<RuntimeControlActorResult<void>>;
      type: "watch_status";
      watcherId: number;
    }
  | {
      type: "close_watch";
      watcherId: number;
    }
  | {
      type: "dispose";
    };

export interface RuntimeControlActor {
  attachShutdownController(controller: GracefulShutdownController): void;
  dispose(): void;
  getStatus(): Promise<RuntimeStatusInit>;
  lease: RuntimeLifecycleLease;
  stop(request: StopRequestInit): Promise<StopResponseInit>;
  watchStatus(
    request: WatchStatusRequestInit,
    signal?: AbortSignal
  ): AsyncIterable<WatchStatusResponseInit>;
}

export function createRuntimeControlActor(input: {
  identity: RuntimeControlIdentity;
  lease: RuntimeLifecycleLease;
  now?: () => Date;
}): RuntimeControlActor {
  const now = input.now ?? (() => new Date());
  const [eventTx, eventRx] = channel<RuntimeControlActorMessage>(64);
  const shutdownControllerRef: {
    current: GracefulShutdownController | null;
  } = {
    current: null,
  };
  const watcherTxById = new Map<number, Sender<WatchStatusResponseInit>>();
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
      watcherTxById,
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
    dispose() {
      void Result.tryPromise({
        try: () =>
          eventTx.send({
            type: "dispose",
          }),
        catch: () => undefined,
      });
    },
    getStatus() {
      return request(
        (responseTx) => ({
          responseTx,
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
      transition(phase) {
        return request(
          (responseTx) => ({
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
  lease: RuntimeLifecycleLease;
  now: () => Date;
  shutdownControllerRef: {
    current: GracefulShutdownController | null;
  };
  signal: AbortSignal;
  watcherTxById: Map<number, Sender<WatchStatusResponseInit>>;
}): Promise<void> {
  let state = args.initialState;

  while (!args.signal.aborted) {
    const message = await args.eventRx.recv(args.signal);
    if (message === null) {
      return;
    }

    switch (message.type) {
      case "get_status":
        respond(message.responseTx, Result.ok(toRuntimeStatusInit(state)));
        break;
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
            args.watcherTxById
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
          args.watcherTxById
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
            args.watcherTxById
          );
        }
        respond(message.responseTx, result.result);
        break;
      }
      case "watch_status": {
        const reduction = reduceRuntimeControlMachine(state, {
          afterSequence: message.afterSequence,
          id: message.watcherId,
          type: "watch_registered",
        });
        state = reduction.state;
        args.watcherTxById.set(message.watcherId, message.eventTx);
        if (message.includeSnapshot && state.sequence > message.afterSequence) {
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
        const reduction = reduceRuntimeControlMachine(state, {
          id: message.watcherId,
          type: "watch_closed",
        });
        state = reduction.state;
        args.watcherTxById.delete(message.watcherId);
        break;
      }
      case "dispose":
        for (const watcherTx of args.watcherTxById.values()) {
          watcherTx.close();
        }
        args.watcherTxById.clear();
        args.eventRx.close();
        return;
      default:
        unreachable(message);
    }
  }
}

async function transitionLifecycleState(args: {
  lease: RuntimeLifecycleLease;
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

  if (reduction.transition === undefined) {
    return Result.ok(reduction);
  }

  const persisted = await Result.tryPromise({
    try: () => args.lease.transition(args.message.phase),
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

async function releaseLifecycleLease(args: {
  lease: RuntimeLifecycleLease;
  message: Extract<RuntimeControlActorMessage, { type: "release" }>;
  now: () => Date;
  state: RuntimeControlMachineState;
}): Promise<{
  reduction: RuntimeControlMachineReduction;
  result: RuntimeControlActorResult<void>;
}> {
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
  lease: RuntimeLifecycleLease;
  message: Extract<RuntimeControlActorMessage, { type: "stop" }>;
  now: () => Date;
  shutdownController: GracefulShutdownController | null;
  state: RuntimeControlMachineState;
}): Promise<{
  reduction?: RuntimeControlMachineReduction;
  result: RuntimeControlActorResult<StopResponseInit>;
}> {
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

  const completion = toRuntimeShutdownCompletion(
    args.message.request.completion ?? RuntimeStopCompletion.UNSPECIFIED
  );
  const requestReason = args.message.request.reason ?? "";
  const reason =
    requestReason.trim().length > 0 ? requestReason : "runtime_control_stop";
  const occurredAt = args.now();
  const reduction = reduceRuntimeControlMachine(args.state, {
    completion,
    occurredAt,
    operationId:
      args.message.request.operationId ?? `stop:${occurredAt.toISOString()}`,
    reason,
    type: "stop_requested",
  });
  if (reduction.type !== "stop") {
    throw new RuntimeControlActorError({
      cause: reduction,
      message: "runtime control reducer returned an invalid stop result",
      operation: "stop",
    });
  }

  if (reduction.transition !== undefined) {
    const persisted = await Result.tryPromise({
      try: () => args.lease.transition("stopping"),
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

  if (reduction.disposition === "accepted") {
    observeRuntimeShutdown(
      args.shutdownController.shutdown(reason, completion),
      args.eventTx,
      reason
    );
  }

  return {
    reduction,
    result: Result.ok({
      disposition: toProtoStopDisposition(reduction.disposition),
      status: toRuntimeStatusInit(reduction.state),
      transition: reduction.transition
        ? toRuntimeTransitionInit(reduction.transition)
        : undefined,
    }),
  };
}

async function commitRuntimeControlReduction(
  reduction: RuntimeControlMachineReduction,
  watcherTxById: Map<number, Sender<WatchStatusResponseInit>>
): Promise<RuntimeControlMachineState> {
  if (reduction.type === "watch") {
    return reduction.state;
  }

  if (reduction.transition === undefined) {
    return reduction.state;
  }

  const staleWatcherIds: number[] = [];
  const event = {
    event: {
      case: "transition",
      value: toRuntimeTransitionInit(reduction.transition),
    },
  } satisfies WatchStatusResponseInit;

  for (const watcher of reduction.state.watchers) {
    if (reduction.transition.sequence <= watcher.afterSequence) {
      continue;
    }

    const watcherTx = watcherTxById.get(watcher.id);
    if (!watcherTx) {
      staleWatcherIds.push(watcher.id);
      continue;
    }

    const sent = await sendWatchEvent(watcherTx, event);
    if (sent.isErr()) {
      staleWatcherIds.push(watcher.id);
    }
  }

  if (staleWatcherIds.length === 0) {
    return reduction.state;
  }

  for (const watcherId of staleWatcherIds) {
    watcherTxById.delete(watcherId);
  }

  return {
    ...reduction.state,
    watchers: reduction.state.watchers.filter(
      (watcher) => !staleWatcherIds.includes(watcher.id)
    ),
  };
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
      afterSequence: args.watchRequest.afterSequence ?? 0n,
      eventTx: watchTx,
      includeSnapshot: args.watchRequest.includeSnapshot ?? false,
      responseTx,
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

function observeRuntimeShutdown(
  shutdown: Promise<void>,
  eventTx: Sender<RuntimeControlActorMessage>,
  reason: string
): void {
  void Result.tryPromise({
    try: async () => {
      await shutdown;
    },
    catch: async () => {
      await Result.tryPromise({
        try: () =>
          eventTx.send({
            phase: "shutdown_failed",
            reason,
            responseTx: oneshot<RuntimeControlActorResult<void>>()[0],
            type: "transition",
          }),
        catch: () => undefined,
      });
    },
  });
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
  state: RuntimeControlMachineState
): RuntimeStatusInit {
  return {
    failure: state.failure ? toRuntimeFailureInit(state.failure) : undefined,
    identity: {
      dataDir: state.identity.dataDir,
      launchId: state.identity.launchId,
      pid: state.identity.pid,
    },
    phase: toProtoPhase(state.phase),
    sequence: state.sequence,
    updatedAt: timestampFromDate(state.updatedAt),
  };
}

function toRuntimeTransitionInit(
  transition: RuntimeControlTransition
): RuntimeTransitionInit {
  return {
    currentPhase: toProtoPhase(transition.currentPhase),
    failure: transition.failure
      ? toRuntimeFailureInit(transition.failure)
      : undefined,
    occurredAt: timestampFromDate(transition.occurredAt),
    operation: transition.operation
      ? {
          name: transition.operation.name,
          operationId: transition.operation.operationId,
        }
      : undefined,
    previousPhase: toProtoPhase(transition.previousPhase),
    reason: transition.reason,
    sequence: transition.sequence,
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
    case "internal":
      return RuntimeFailureCode.INTERNAL;
    default:
      return unreachable(code);
  }
}
