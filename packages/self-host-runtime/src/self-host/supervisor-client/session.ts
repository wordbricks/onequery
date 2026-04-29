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
import type { Receiver } from "antiox/sync/mpsc";
import { TaggedError } from "better-result";

import type { SupervisorLifecycleClient } from "./client";

type OpenRuntimeSessionRequestInit = MessageInitShape<
  typeof OpenRuntimeSessionRequestSchema
>;
type RuntimeStatusInit = MessageInitShape<typeof RuntimeStatusSchema>;
type SupervisorIdentityInit = MessageInitShape<typeof SupervisorIdentitySchema>;

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
  onStopCommand?: (
    command: SupervisorStopCommand
  ) =>
    | Promise<{ status?: RuntimeStatusInit } | void>
    | { status?: RuntimeStatusInit }
    | void;
  runtimePid?: number;
  runtimeSequence?: bigint;
  supervisor: SupervisorIdentityInit;
}): SupervisorRuntimeSession {
  const now = input.now ?? (() => new Date());
  const runtimePid = input.runtimePid ?? process.pid;
  const [eventTx, eventRx] = channel<OpenRuntimeSessionRequestInit>(16);
  const abortController = new AbortController();
  let closed = false;
  let heartbeatSequence = 0n;
  let runtimeSequence = input.runtimeSequence ?? 1n;

  const sendEvent = async (
    payload: OpenRuntimeSessionRequestInit["payload"],
    operation: string
  ) => {
    if (closed) {
      throw new SupervisorRuntimeSessionError({
        cause: null,
        message: "supervisor runtime session is closed",
        operation,
      });
    }

    await eventTx.send({ payload });
  };

  const responseStream = input.client.openRuntimeSession(readEvents(eventRx), {
    signal: abortController.signal,
  });
  const opened = sendEvent(
    {
      case: "hello",
      value: {
        dataDir: input.dataDir,
        launchId: input.launchId,
        runtimePid,
        runtimeSequence,
        startedAt: timestampFromDate(now()),
        supervisor: input.supervisor,
      },
    },
    "hello"
  );
  void opened.catch(() => {});

  const heartbeatTimer = setInterval(() => {
    void sendHeartbeat({
      now,
      operation: "heartbeat_interval",
      sendEvent,
      sequence: (heartbeatSequence += 1n),
    });
  }, input.heartbeatIntervalMs ?? 10_000);
  heartbeatTimer.unref?.();
  const closedPromise = observeCommands({
    abortController,
    dataDir: input.dataDir,
    launchId: input.launchId,
    now,
    onStopCommand: input.onStopCommand,
    responseStream,
    runtimePid,
    sendEvent,
    getRuntimeSequence: () => runtimeSequence,
    setRuntimeStatus: (status) => {
      runtimeSequence = status.runtimeSequence ?? runtimeSequence;
    },
  }).finally(() => {
    closed = true;
    clearHeartbeatTimer(heartbeatTimer);
    eventTx.close();
    eventRx.close();
  });

  return {
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      clearHeartbeatTimer(heartbeatTimer);
      eventTx.close();
      eventRx.close();
      abortController.abort();
      await closedPromise.catch((cause) => {
        throw new SupervisorRuntimeSessionError({
          cause,
          message: "supervisor runtime session command stream failed",
          operation: "close",
        });
      });
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

async function sendHeartbeat(input: {
  now: () => Date;
  operation: string;
  sendEvent(
    payload: OpenRuntimeSessionRequestInit["payload"],
    operation: string
  ): Promise<void>;
  sequence: bigint;
}): Promise<void> {
  await input.sendEvent(
    {
      case: "heartbeat",
      value: {
        heartbeatSequence: input.sequence,
        sentAt: timestampFromDate(input.now()),
      },
    },
    input.operation
  );
}

async function* readEvents(
  eventRx: Receiver<OpenRuntimeSessionRequestInit>
): AsyncIterable<OpenRuntimeSessionRequestInit> {
  while (true) {
    const event = await eventRx.recv();
    if (event === null) {
      return;
    }

    yield event;
  }
}

async function observeCommands(input: {
  abortController: AbortController;
  dataDir: string;
  getRuntimeSequence(): bigint;
  launchId: string;
  now: () => Date;
  onStopCommand?: (
    command: SupervisorStopCommand
  ) =>
    | Promise<{ status?: RuntimeStatusInit } | void>
    | { status?: RuntimeStatusInit }
    | void;
  responseStream: AsyncIterable<OpenRuntimeSessionResponse>;
  sendEvent(
    payload: OpenRuntimeSessionRequestInit["payload"],
    operation: string
  ): Promise<void>;
  runtimePid: number;
  setRuntimeStatus(status: RuntimeStatusInit): void;
}): Promise<void> {
  try {
    for await (const response of input.responseStream) {
      const responsePayload = response.response;
      switch (responsePayload.case) {
        case "close":
          input.abortController.abort();
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
          });
          break;
        case undefined:
          break;
      }
    }
  } catch (cause) {
    if (!input.abortController.signal.aborted) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      input.abortController.abort();
      throw cause;
    }
  }
}

async function handleStopCommand(input: {
  command: SupervisorStopCommand;
  dataDir: string;
  getRuntimeSequence(): bigint;
  launchId: string;
  now: () => Date;
  onStopCommand?: (
    command: SupervisorStopCommand
  ) =>
    | Promise<{ status?: RuntimeStatusInit } | void>
    | { status?: RuntimeStatusInit }
    | void;
  sendEvent(
    payload: OpenRuntimeSessionRequestInit["payload"],
    operation: string
  ): Promise<void>;
  runtimePid: number;
  setRuntimeStatus(status: RuntimeStatusInit): void;
}): Promise<void> {
  const operationId = input.command.operationId;
  const reason = input.command.reason || "supervisor_stop";

  void input
    .sendEvent(
      {
        case: "shutdownStarted",
        value: {
          operationId,
          reason,
          runtimeSequence: input.getRuntimeSequence(),
          startedAt: timestampFromDate(input.now()),
        },
      },
      "shutdown_started"
    )
    .catch(() => {});

  try {
    const result = await input.onStopCommand?.(input.command);
    const status = runtimeStatusFromStopResult(result);
    if (status) {
      input.setRuntimeStatus(status);
      void input
        .sendEvent(
          {
            case: "shutdownFinished",
            value: {
              finishedAt: timestampFromDate(input.now()),
              operationId,
              status,
            },
          },
          "shutdown_finished"
        )
        .catch(() => {});
    }
  } catch (cause) {
    const failedAt = input.now();
    const failure = {
      code: RuntimeFailureCode.INTERNAL,
      message: cause instanceof Error ? cause.message : String(cause),
      retryable: false,
    };
    const status = {
      failure,
      identity: {
        dataDir: input.dataDir,
        launchId: input.launchId,
        pid: input.runtimePid,
      },
      phase: RuntimePhase.SHUTDOWN_FAILED,
      runtimeSequence: input.getRuntimeSequence() + 1n,
      updatedAt: timestampFromDate(failedAt),
    };
    input.setRuntimeStatus(status);
    void input
      .sendEvent(
        {
          case: "shutdownFailed",
          value: {
            failedAt: timestampFromDate(failedAt),
            failure,
            operationId,
            status,
          },
        },
        "shutdown_failed"
      )
      .catch(() => {});
    throw cause;
  }
}

function runtimeStatusFromStopResult(
  result: { status?: RuntimeStatusInit } | void
): RuntimeStatusInit | undefined {
  return result?.status;
}

function clearHeartbeatTimer(
  heartbeatTimer: ReturnType<typeof setInterval> | undefined
): void {
  if (heartbeatTimer !== undefined) {
    clearInterval(heartbeatTimer);
  }
}
