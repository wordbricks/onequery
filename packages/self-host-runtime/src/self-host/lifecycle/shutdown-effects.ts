import { unreachable } from "antiox/panic";
import type { Receiver, Sender } from "antiox/sync/mpsc";
import type { OneshotSender } from "antiox/sync/oneshot";
import { spawn } from "antiox/task";
import { Result } from "better-result";

import { RuntimeShutdownError } from "./errors";
import type {
  ShutdownMachineEffect,
  ShutdownMachineEvent,
  ShutdownResult,
} from "./shutdown-machine";

export function runShutdownMachineEffects(
  effects: readonly ShutdownMachineEffect[],
  args: {
    eventRx: Receiver<ShutdownMachineEvent>;
    eventTx: Sender<ShutdownMachineEvent>;
    executeShutdown(reason: string): Promise<ShutdownResult>;
    exitProcess(code: number): void;
  }
): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "close_event_receiver":
        args.eventRx.close();
        break;
      case "start_shutdown":
        spawnShutdownWorker(effect.reason, args);
        break;
      case "respond":
        respondToShutdownRequests(effect.responders, effect.result);
        break;
      case "exit":
        args.exitProcess(effect.code);
        break;
      default:
        unreachable(effect);
    }
  }
}

function spawnShutdownWorker(
  reason: string,
  args: {
    eventTx: Sender<ShutdownMachineEvent>;
    executeShutdown(reason: string): Promise<ShutdownResult>;
  }
): void {
  const handle = spawn(async () => {
    const execution = await Result.tryPromise({
      try: () => args.executeShutdown(reason),
      catch: (cause) =>
        new RuntimeShutdownError({
          cause,
          message: `failed to execute runtime shutdown for ${reason}`,
          reason,
        }),
    });
    const result = execution.isOk()
      ? execution.value
      : Result.err(execution.error);

    await Result.tryPromise({
      try: () =>
        args.eventTx.send({
          type: "shutdown_finished",
          result,
        }),
      catch: () => undefined,
    });
  });

  // Comment: the worker converts shutdown failures into a machine event; this
  // observer only prevents unexpected task failures from becoming unhandled.
  void Result.tryPromise({
    try: async () => {
      await handle;
    },
    catch: () => undefined,
  });
}

function respondToShutdownRequests(
  responders: readonly OneshotSender<ShutdownResult>[],
  result: ShutdownResult
): void {
  for (const responder of responders) {
    // Comment: callers may already have stopped awaiting the shutdown result,
    // but the controller still needs to complete the shared shutdown flow.
    Result.try(() => responder.send(result));
  }
}
