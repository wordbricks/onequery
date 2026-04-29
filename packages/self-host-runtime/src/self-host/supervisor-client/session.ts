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
  let eventSequence = 0n;
  let heartbeatSequence = 0n;
  let runtimePhase = RuntimePhase.STARTING;
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

    eventSequence += 1n;
    await eventTx.send({
      eventId: `${input.launchId}:${eventSequence}`,
      payload,
    });
  };

  const responseStream = input.client.openRuntimeSession(readEvents(eventRx), {
    signal: abortController.signal,
  });
  void sendEvent(
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

  const heartbeatTimer = setInterval(() => {
    void sendHeartbeat({
      now,
      operation: "heartbeat_interval",
      runtimePhase,
      runtimeSequence,
      sendEvent,
      sequence: (heartbeatSequence += 1n),
    });
  }, input.heartbeatIntervalMs ?? 10_000);
  heartbeatTimer.unref?.();
  const closedPromise = observeCommands({
    abortController,
    now,
    onStopCommand: input.onStopCommand,
    responseStream,
    sendEvent,
    getRuntimeSequence: () => runtimeSequence,
    setRuntimeStatus: (status) => {
      runtimePhase = status.phase ?? runtimePhase;
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
    heartbeat() {
      heartbeatSequence += 1n;
      return sendHeartbeat({
        now,
        operation: "heartbeat",
        runtimePhase,
        runtimeSequence,
        sendEvent,
        sequence: heartbeatSequence,
      });
    },
    ready(status) {
      runtimePhase = status.phase ?? runtimePhase;
      runtimeSequence = status.runtimeSequence ?? runtimeSequence;
      return sendEvent(
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
  runtimePhase: RuntimePhase;
  runtimeSequence: bigint;
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
        runtimePhase: input.runtimePhase,
        runtimeSequence: input.runtimeSequence,
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
  getRuntimeSequence(): bigint;
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
  setRuntimeStatus(status: RuntimeStatusInit): void;
}): Promise<void> {
  try {
    for await (const response of input.responseStream) {
      const command = response.command;
      switch (command.case) {
        case "close":
          input.abortController.abort();
          return;
        case "ping":
          break;
        case "stop":
          await handleStopCommand({
            command: command.value,
            getRuntimeSequence: input.getRuntimeSequence,
            now: input.now,
            onStopCommand: input.onStopCommand,
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
      throw cause;
    }
  }
}

async function handleStopCommand(input: {
  command: SupervisorStopCommand;
  getRuntimeSequence(): bigint;
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
  setRuntimeStatus(status: RuntimeStatusInit): void;
}): Promise<void> {
  const operationId = input.command.operationId;
  const reason = input.command.reason || "supervisor_stop";

  await input.sendEvent(
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
  );

  try {
    const result = await input.onStopCommand?.(input.command);
    const status = runtimeStatusFromStopResult(result);
    if (status) {
      input.setRuntimeStatus(status);
      await input.sendEvent(
        {
          case: "shutdownFinished",
          value: {
            finishedAt: timestampFromDate(input.now()),
            operationId,
            status,
          },
        },
        "shutdown_finished"
      );
    }
  } catch (cause) {
    await input.sendEvent(
      {
        case: "shutdownFailed",
        value: {
          failedAt: timestampFromDate(input.now()),
          failure: {
            code: RuntimeFailureCode.INTERNAL,
            message: cause instanceof Error ? cause.message : String(cause),
            retryable: false,
          },
          operationId,
        },
      },
      "shutdown_failed"
    );
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
