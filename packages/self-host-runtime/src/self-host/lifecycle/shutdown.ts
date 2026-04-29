import { channel } from "antiox/sync/mpsc";
import type { Receiver, Sender } from "antiox/sync/mpsc";
import { oneshot } from "antiox/sync/oneshot";
import { spawn } from "antiox/task";
import type { JoinHandle } from "antiox/task";
import { Result } from "better-result";

import { RuntimeShutdownError } from "./errors";
import { runShutdownMachineEffects } from "./shutdown-effects";
import {
  createDisposedShutdownError,
  initialShutdownMachineState,
  reduceShutdownMachine,
} from "./shutdown-machine";
import type {
  ShutdownCompletion,
  ShutdownMachineEvent,
  ShutdownResult,
} from "./shutdown-machine";
import type {
  GracefulShutdownController,
  LifecycleLogWriter,
  ProcessSignalSource,
  RuntimeLifecycleLease,
  RuntimeLifecyclePhase,
  RuntimeShutdownResource,
  ServerHandle,
} from "./types";

export function attachGracefulShutdownHandlers(args: {
  exitProcess?: (code: number) => void;
  lease: RuntimeLifecycleLease;
  processSignals?: ProcessSignalSource;
  server: ServerHandle;
  shutdownResources?: readonly RuntimeShutdownResource[];
  logWriter?: LifecycleLogWriter;
}): GracefulShutdownController {
  const exitProcess =
    args.exitProcess ?? ((code: number) => process.exit(code));
  const processSignals = args.processSignals ?? process;
  const logWriter = args.logWriter ?? { append: async () => {} };
  const [eventTx, eventRx] = channel<ShutdownMachineEvent>(16);
  const handleSigint = () => {
    requestSignalShutdown("SIGINT");
  };
  const handleSigterm = () => {
    requestSignalShutdown("SIGTERM");
  };
  let disposed = false;
  const coordinatorTask = spawn(async (signal) => {
    await runShutdownCoordinator({
      eventRx,
      eventTx,
      executeShutdown: (reason) =>
        executeShutdown({
          lease: args.lease,
          logWriter,
          reason,
          server: args.server,
          shutdownResources: args.shutdownResources ?? [],
        }),
      exitProcess,
      signal,
    });
  });
  observeShutdownCoordinator(coordinatorTask, logWriter);

  const requestShutdown = async (
    reason: string,
    completion: ShutdownCompletion = "cleanup_only"
  ) => {
    if (disposed) {
      throw createDisposedShutdownError(reason);
    }

    const [responseTx, responseRx] = oneshot<ShutdownResult>();
    const coordination = await Result.tryPromise({
      try: async () => {
        await eventTx.send({
          type: "shutdown_requested",
          completion,
          reason,
          responseTx,
        });
        return responseRx;
      },
      catch: (cause) =>
        new RuntimeShutdownError({
          cause,
          message: `failed to coordinate runtime shutdown for ${reason}`,
          reason,
        }),
    });
    if (coordination.isErr()) {
      throw coordination.error;
    }

    const result = coordination.value;
    if (result.isErr()) {
      throw result.error;
    }
  };

  const requestSignalShutdown = (reason: "SIGINT" | "SIGTERM") => {
    void Result.tryPromise({
      try: () => requestShutdown(reason, "cleanup_and_exit"),
      catch: () => undefined,
    });
  };

  processSignals.once("SIGINT", handleSigint);
  processSignals.once("SIGTERM", handleSigterm);

  return {
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      processSignals.off("SIGINT", handleSigint);
      processSignals.off("SIGTERM", handleSigterm);
      void Result.tryPromise({
        try: () =>
          eventTx.send({
            type: "controller_disposed",
          }),
        catch: () => undefined,
      });
    },
    shutdown(reason: string, completion?: ShutdownCompletion) {
      return requestShutdown(reason, completion);
    },
  };
}

async function runShutdownCoordinator(args: {
  eventRx: Receiver<ShutdownMachineEvent>;
  eventTx: Sender<ShutdownMachineEvent>;
  executeShutdown(reason: string): Promise<ShutdownResult>;
  exitProcess(code: number): void;
  signal: AbortSignal;
}): Promise<void> {
  let state = initialShutdownMachineState;

  while (!args.signal.aborted) {
    const event = await args.eventRx.recv(args.signal);
    if (event === null) {
      return;
    }

    const transition = reduceShutdownMachine(state, event);
    state = transition.state;
    runShutdownMachineEffects(transition.effects, {
      eventRx: args.eventRx,
      eventTx: args.eventTx,
      executeShutdown: (reason) => args.executeShutdown(reason),
      exitProcess: (code) => args.exitProcess(code),
    });
  }
}

function observeShutdownCoordinator(
  handle: JoinHandle<void>,
  logWriter: LifecycleLogWriter
): void {
  void handle.then(
    () => undefined,
    (cause) => {
      void Result.tryPromise({
        try: () =>
          logWriter.append(
            `[runtime] shutdown coordinator failed cause=${String(cause)}`
          ),
        catch: () => undefined,
      });
    }
  );
}

async function executeShutdown(args: {
  lease: RuntimeLifecycleLease;
  logWriter: LifecycleLogWriter;
  reason: string;
  server: ServerHandle;
  shutdownResources: readonly RuntimeShutdownResource[];
}): Promise<ShutdownResult> {
  const requestLogResult = await Result.tryPromise({
    try: async () =>
      args.logWriter.append(
        `[runtime] graceful shutdown requested reason=${args.reason}`
      ),
    catch: (cause) =>
      new RuntimeShutdownError({
        cause,
        message: `failed to record runtime shutdown request for ${args.reason}`,
        reason: args.reason,
      }),
  });
  if (requestLogResult.isErr()) {
    return Result.err(requestLogResult.error);
  }

  const stoppingTransitionResult = await transitionShutdownPhase(args, {
    message: `failed to record runtime shutdown state for ${args.reason}`,
    phase: "stopping",
  });
  const drainingTransitionResult = await transitionShutdownPhase(args, {
    message: `failed to record runtime drain state for ${args.reason}`,
    phase: "draining",
  });
  const stopResult = await Result.tryPromise({
    try: async () => {
      await args.server.stop(true);
    },
    catch: (cause) =>
      new RuntimeShutdownError({
        cause,
        message: `failed to stop runtime server for ${args.reason}`,
        reason: args.reason,
      }),
  });
  const checkpointingTransitionResult = await transitionShutdownPhase(args, {
    message: `failed to record runtime storage checkpoint state for ${args.reason}`,
    phase: "checkpointing",
  });
  const closeResourcesResult = await closeShutdownResources(
    args.shutdownResources,
    args.reason
  );

  let releaseResult: ShutdownResult | null = null;
  let failedTransitionResult: ShutdownResult | null = null;
  if (stopResult.isOk() && closeResourcesResult.isOk()) {
    releaseResult = await Result.tryPromise({
      try: async () => {
        await args.lease.release({
          reason: args.reason,
          stopServer: true,
        });
      },
      catch: (cause) =>
        new RuntimeShutdownError({
          cause,
          message: `failed to release lifecycle lease for ${args.reason}`,
          reason: args.reason,
        }),
    });
  } else {
    failedTransitionResult = await transitionShutdownPhase(args, {
      message: `failed to record runtime shutdown failure state for ${args.reason}`,
      phase: "shutdown_failed",
    });
  }

  if (
    stoppingTransitionResult.isOk() &&
    drainingTransitionResult.isOk() &&
    stopResult.isOk() &&
    checkpointingTransitionResult.isOk() &&
    closeResourcesResult.isOk() &&
    releaseResult?.isOk()
  ) {
    return Result.ok(undefined);
  }

  const causes = [
    stoppingTransitionResult.isErr()
      ? stoppingTransitionResult.error.cause
      : null,
    drainingTransitionResult.isErr()
      ? drainingTransitionResult.error.cause
      : null,
    stopResult.isErr() ? stopResult.error.cause : null,
    checkpointingTransitionResult.isErr()
      ? checkpointingTransitionResult.error.cause
      : null,
    closeResourcesResult.isErr() ? closeResourcesResult.error.cause : null,
    releaseResult?.isErr() ? releaseResult.error.cause : null,
    failedTransitionResult?.isErr() ? failedTransitionResult.error.cause : null,
  ].filter((cause): cause is unknown => cause !== null);

  return Result.err(
    new RuntimeShutdownError({
      cause:
        causes.length === 1
          ? causes[0]
          : new AggregateError(
              causes,
              `failed to shut down runtime for ${args.reason}`
            ),
      message: `failed to shut down runtime for ${args.reason}`,
      reason: args.reason,
    })
  );
}

async function transitionShutdownPhase(
  args: {
    lease: RuntimeLifecycleLease;
    reason: string;
  },
  transition: {
    message: string;
    phase: RuntimeLifecyclePhase;
  }
): Promise<ShutdownResult> {
  return Result.tryPromise({
    try: async () => {
      await args.lease.transition(transition.phase);
    },
    catch: (cause) =>
      new RuntimeShutdownError({
        cause,
        message: transition.message,
        reason: args.reason,
      }),
  });
}

async function closeShutdownResources(
  resources: readonly RuntimeShutdownResource[],
  reason: string
): Promise<ShutdownResult> {
  const errors: RuntimeShutdownError[] = [];

  for (const resource of resources) {
    const closeResult = await Result.tryPromise({
      try: async () => {
        await resource.close();
      },
      catch: (cause) =>
        new RuntimeShutdownError({
          cause,
          message: `failed to close runtime resource ${resource.name} for ${reason}`,
          reason,
        }),
    });

    if (closeResult.isErr()) {
      errors.push(closeResult.error);
    }
  }

  if (errors.length === 0) {
    return Result.ok(undefined);
  }

  return Result.err(
    new RuntimeShutdownError({
      cause:
        errors.length === 1
          ? errors[0]?.cause
          : new AggregateError(
              errors.map((error) => error.cause),
              `failed to close runtime resources for ${reason}`
            ),
      message: `failed to close runtime resources for ${reason}`,
      reason,
    })
  );
}
