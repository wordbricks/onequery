import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  RuntimeFailureCode,
  RuntimePhase,
  RuntimeStatusSchema,
  SupervisorIdentitySchema,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import { OpenRuntimeSessionRequestSchema } from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import type {
  OpenRuntimeSessionResponse,
  SupervisorStopCommand,
} from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import { channel } from "antiox/sync/mpsc";
import { JoinError, spawn, yieldNow } from "antiox/task";
import { interval } from "antiox/time";
import { Result, TaggedError } from "better-result";

import type { SupervisorLifecycleClient } from "./client";

type OpenRuntimeSessionRequestInit = MessageInitShape<
  typeof OpenRuntimeSessionRequestSchema
>;
type RuntimeStatusInit = MessageInitShape<typeof RuntimeStatusSchema>;
type SupervisorIdentityInit = MessageInitShape<typeof SupervisorIdentitySchema>;
type SupervisorStopCommandResult = {
  status: RuntimeStatusInit;
};
type SupervisorStopCommandHandler = (
  command: SupervisorStopCommand
) => Promise<SupervisorStopCommandResult> | SupervisorStopCommandResult;
type SupervisorSessionSendEvent = (
  payload: OpenRuntimeSessionRequestInit["payload"],
  operation: string,
  signal?: AbortSignal
) => Promise<void>;

export class SupervisorRuntimeSessionError extends TaggedError(
  "SupervisorRuntimeSessionError"
)<{
  cause: unknown;
  message: string;
  operation: string;
}>() {}

export interface SupervisorRuntimeSession {
  close(): Promise<void>;
  closed: Promise<void>;
  heartbeat(): Promise<void>;
  opened: Promise<void>;
  ready(status: RuntimeStatusInit): Promise<void>;
}

export function openSupervisorRuntimeSession(input: {
  client: SupervisorLifecycleClient;
  dataDir: string;
  heartbeatIntervalMs?: number;
  launchId: string;
  now?: () => Date;
  onStopCommand?: SupervisorStopCommandHandler;
  runtimePid?: number;
  runtimeSequence?: bigint;
  supervisor: SupervisorIdentityInit;
}): SupervisorRuntimeSession {
  const now = input.now ?? (() => new Date());
  const runtimePid = input.runtimePid ?? process.pid;
  const [eventTx, eventRx] = channel<OpenRuntimeSessionRequestInit>(16);
  const openedHandshake = deferred<void>();
  let closed = false;
  let heartbeatSequence = 0n;
  let runtimeSequence = input.runtimeSequence ?? 1n;

  const sendEvent = async (
    payload: OpenRuntimeSessionRequestInit["payload"],
    operation: string,
    signal?: AbortSignal
  ) => {
    if (closed) {
      throw new SupervisorRuntimeSessionError({
        cause: null,
        message: "supervisor runtime session is closed",
        operation,
      });
    }

    const sendResult = await Result.tryPromise({
      try: async () => {
        await eventTx.send({ payload }, signal);
      },
      catch: (cause) =>
        new SupervisorRuntimeSessionError({
          cause,
          message: `failed to send supervisor runtime session event for ${operation}`,
          operation,
        }),
    });
    if (sendResult.isErr()) {
      throw sendResult.error;
    }
  };

  const openedSend = sendEvent(
    {
      case: "hello",
      value: {
        dataDir: input.dataDir,
        launchId: input.launchId,
        runtimePid,
        supervisor: input.supervisor,
      },
    },
    "hello"
  );
  void openedSend.catch((cause: unknown) => {
    openedHandshake.reject(cause);
  });

  const commandTask = spawn(async (signal) => {
    // Comment: Connect's streaming response iterator does not expose return(),
    // so local handler failures must abort the call to release the server stream.
    const connectCallAbortController = new AbortController();
    const abortConnectCall = () => {
      connectCallAbortController.abort(signal.reason);
    };
    signal.addEventListener("abort", abortConnectCall, { once: true });
    const responseStream = input.client.openRuntimeSession(eventRx, {
      signal: connectCallAbortController.signal,
    });

    try {
      await openedSend;
      await observeCommands({
        dataDir: input.dataDir,
        markOpened: openedHandshake.resolve,
        launchId: input.launchId,
        now,
        onStopCommand: input.onStopCommand,
        responseStream,
        runtimePid,
        signal,
        sendEvent,
        getRuntimeSequence: () => runtimeSequence,
        setRuntimeStatus: (status) => {
          runtimeSequence = status.runtimeSequence ?? runtimeSequence;
        },
      });
    } catch (cause) {
      openedHandshake.reject(cause);
      await yieldNow();
      connectCallAbortController.abort(cause);
      throw cause;
    } finally {
      signal.removeEventListener("abort", abortConnectCall);
      connectCallAbortController.abort();
    }
  });
  const opened = openedHandshake.promise;
  observePromise(opened);

  const heartbeatTask = spawn(async (signal) => {
    for await (const tick of interval(
      input.heartbeatIntervalMs ?? 10_000,
      signal
    )) {
      if (tick === 0) {
        continue;
      }

      await sendHeartbeat({
        now,
        operation: "heartbeat_interval",
        sendEvent,
        sequence: (heartbeatSequence += 1n),
        signal,
      });
    }
  });

  const closeSession = (input?: { abortCommandTask?: boolean }) => {
    closed = true;
    heartbeatTask.abort();
    if (input?.abortCommandTask === true) {
      commandTask.abort();
    }
    eventTx.close();
    eventRx.close();
  };
  const closedPromise = Promise.race([
    commandTaskClosure(commandTask),
    heartbeatTaskClosure(heartbeatTask),
  ]).finally(() => {
    closeSession({ abortCommandTask: true });
  });

  return {
    async close() {
      if (closed) {
        return;
      }

      closeSession();
      commandTask.abort();
      const closeResult = await Result.tryPromise({
        try: async () => {
          await closedPromise;
        },
        catch: (cause) =>
          new SupervisorRuntimeSessionError({
            cause,
            message: "supervisor runtime session command stream failed",
            operation: "close",
          }),
      });
      if (closeResult.isErr()) {
        throw closeResult.error;
      }
    },
    closed: closedPromise,
    opened,
    async heartbeat() {
      await opened;
      heartbeatSequence += 1n;
      await sendHeartbeat({
        now,
        operation: "heartbeat",
        sendEvent,
        sequence: heartbeatSequence,
      });
    },
    async ready(status) {
      await opened;
      runtimeSequence = status.runtimeSequence ?? runtimeSequence;
      await sendEvent(
        {
          case: "runtimeReady",
          value: {
            status,
          },
        },
        "ready"
      );
    },
  };
}

function observePromise(promise: Promise<unknown>): void {
  void Result.tryPromise({
    try: async () => {
      await promise;
    },
    catch: () => undefined,
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  reject(cause: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolveDeferred: (value: T | PromiseLike<T>) => void = () => undefined;
  let rejectDeferred: (cause: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  return { promise, reject: rejectDeferred, resolve: resolveDeferred };
}

async function commandTaskClosure(task: PromiseLike<void>): Promise<void> {
  const result = await Result.tryPromise({
    try: async () => {
      await task;
    },
    catch: (cause) => cause,
  });

  if (result.isOk()) {
    return;
  }
  if (isCancelledJoinError(result.error)) {
    return;
  }

  throw unwrapJoinError(result.error);
}

async function heartbeatTaskClosure(task: PromiseLike<void>): Promise<void> {
  const result = await Result.tryPromise({
    try: async () => {
      await task;
    },
    catch: (cause) => cause,
  });

  if (result.isOk()) {
    return;
  }
  if (isCancelledJoinError(result.error)) {
    await new Promise<void>(() => {});
    return;
  }

  throw unwrapJoinError(result.error);
}

function isCancelledJoinError(cause: unknown): boolean {
  return cause instanceof JoinError && cause.cancelled;
}

function unwrapJoinError(cause: unknown): unknown {
  return cause instanceof JoinError && cause.cause !== undefined
    ? cause.cause
    : cause;
}

async function sendHeartbeat(input: {
  now: () => Date;
  operation: string;
  sendEvent: SupervisorSessionSendEvent;
  sequence: bigint;
  signal?: AbortSignal;
}): Promise<void> {
  await input.sendEvent(
    {
      case: "heartbeat",
      value: {
        heartbeatSequence: input.sequence,
        sentAt: timestampFromDate(input.now()),
      },
    },
    input.operation,
    input.signal
  );
}

async function observeCommands(input: {
  dataDir: string;
  getRuntimeSequence(): bigint;
  launchId: string;
  markOpened(): void;
  now: () => Date;
  onStopCommand?: SupervisorStopCommandHandler;
  responseStream: AsyncIterable<OpenRuntimeSessionResponse>;
  sendEvent: SupervisorSessionSendEvent;
  runtimePid: number;
  setRuntimeStatus(status: RuntimeStatusInit): void;
  signal: AbortSignal;
}): Promise<void> {
  let opened = false;
  const markOpenedOnce = () => {
    if (opened) {
      return;
    }

    opened = true;
    input.markOpened();
  };

  for await (const response of input.responseStream) {
    const responsePayload = response.response;
    if (responsePayload.case !== undefined) {
      markOpenedOnce();
    }

    switch (responsePayload.case) {
      case "opened":
        break;
      case "close":
        return;
      case "stop":
        await handleStopCommand({
          command: responsePayload.value,
          dataDir: input.dataDir,
          getRuntimeSequence: input.getRuntimeSequence,
          launchId: input.launchId,
          now: input.now,
          onStopCommand: input.onStopCommand,
          runtimePid: input.runtimePid,
          sendEvent: input.sendEvent,
          setRuntimeStatus: input.setRuntimeStatus,
          signal: input.signal,
        });
        break;
      case undefined:
        break;
    }
  }

  if (!opened) {
    throw new SupervisorRuntimeSessionError({
      cause: null,
      message:
        "supervisor runtime session closed before opened acknowledgement",
      operation: "open",
    });
  }
}

async function handleStopCommand(input: {
  command: SupervisorStopCommand;
  dataDir: string;
  getRuntimeSequence(): bigint;
  launchId: string;
  now: () => Date;
  onStopCommand?: SupervisorStopCommandHandler;
  sendEvent: SupervisorSessionSendEvent;
  runtimePid: number;
  setRuntimeStatus(status: RuntimeStatusInit): void;
  signal: AbortSignal;
}): Promise<void> {
  const operationId = input.command.operationId;
  const reason = input.command.reason || "supervisor_stop";

  await sendEventBestEffort(() =>
    input.sendEvent(
      {
        case: "shutdownStarted",
        value: {
          operationId,
          reason,
          runtimeSequence: input.getRuntimeSequence(),
          startedAt: timestampFromDate(input.now()),
        },
      },
      "shutdown_started",
      input.signal
    )
  );

  const stopResult = await Result.tryPromise({
    try: async () => {
      if (!input.onStopCommand) {
        throw new Error(
          "received supervisor stop command without a stop handler"
        );
      }
      return await input.onStopCommand(input.command);
    },
    catch: (cause) => cause,
  });

  if (stopResult.isOk()) {
    const { status } = stopResult.value;
    input.setRuntimeStatus(status);
    await sendEventBestEffort(() =>
      input.sendEvent(
        {
          case: "shutdownFinished",
          value: {
            finishedAt: timestampFromDate(input.now()),
            operationId,
            status,
          },
        },
        "shutdown_finished",
        input.signal
      )
    );
    return;
  }

  const cause = stopResult.error;
  const failedAt = input.now();
  const failure = {
    code: RuntimeFailureCode.INTERNAL,
    message: cause instanceof Error ? cause.message : String(cause),
    retryable: false,
  };
  const status = {
    failure,
    phase: RuntimePhase.SHUTDOWN_FAILED,
    runtimeSequence: input.getRuntimeSequence() + 1n,
    updatedAt: timestampFromDate(failedAt),
  };
  input.setRuntimeStatus(status);
  await sendEventBestEffort(() =>
    input.sendEvent(
      {
        case: "shutdownFailed",
        value: {
          failedAt: timestampFromDate(failedAt),
          failure,
          operationId,
          status,
        },
      },
      "shutdown_failed",
      input.signal
    )
  );
  throw cause;
}

async function sendEventBestEffort(
  sendEvent: () => Promise<void>
): Promise<void> {
  await Result.tryPromise({
    try: sendEvent,
    catch: () => undefined,
  });
}
