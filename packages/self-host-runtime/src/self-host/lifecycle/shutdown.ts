import { channel } from "antiox/sync/mpsc";
import type { Receiver, Sender } from "antiox/sync/mpsc";
import { oneshot } from "antiox/sync/oneshot";
import { spawn } from "antiox/task";
import type { JoinHandle } from "antiox/task";
import { Result } from "better-result";

import { RuntimeShutdownError, createRuntimeShutdownError } from "./errors";
import { runShutdownMachineEffects } from "./shutdown-effects";
import {
  createDisposedShutdownError,
  initialShutdownMachineState,
  reduceShutdownMachine,
} from "./shutdown-machine";
import type { ShutdownMachineEvent, ShutdownResult } from "./shutdown-machine";
import type {
  GracefulShutdownController,
  LifecycleLogWriter,
  ProcessSignalSource,
  RuntimeLifecycleLease,
  RuntimeLifecycleFailure,
  RuntimeLifecycleFailureCode,
  RuntimeLifecyclePhase,
  RuntimeShutdownRequest,
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
      executeShutdown: (request) =>
        executeShutdown({
          lease: args.lease,
          logWriter,
          request,
          server: args.server,
          shutdownResources: args.shutdownResources ?? [],
        }),
      exitProcess,
      signal,
    });
  });
  observeShutdownCoordinator(coordinatorTask, logWriter);

  const requestShutdown = async (request: RuntimeShutdownRequest) => {
    if (disposed) {
      throw createDisposedShutdownError(request.reason);
    }

    const [responseTx, responseRx] = oneshot<ShutdownResult>();
    const coordination = await Result.tryPromise({
      try: async () => {
        await eventTx.send({
          request,
          responseTx,
          type: "shutdown_requested",
        });
        return responseRx;
      },
      catch: (cause) =>
        createRuntimeShutdownError({
          cause,
          code: "internal",
          message: `failed to coordinate runtime shutdown for ${request.reason}`,
          reason: request.reason,
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
      try: () =>
        requestShutdown({
          completion: "cleanup_and_exit",
          reason,
        }),
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
    shutdown(request) {
      return requestShutdown(request);
    },
  };
}

async function runShutdownCoordinator(args: {
  eventRx: Receiver<ShutdownMachineEvent>;
  eventTx: Sender<ShutdownMachineEvent>;
  executeShutdown(request: RuntimeShutdownRequest): Promise<ShutdownResult>;
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
      executeShutdown: (request) => args.executeShutdown(request),
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
  request: RuntimeShutdownRequest;
  server: ServerHandle;
  shutdownResources: readonly RuntimeShutdownResource[];
}): Promise<ShutdownResult> {
  const reason = args.request.reason;
  const requestLogResult = await Result.tryPromise({
    try: async () =>
      args.logWriter.append(
        `[runtime] graceful shutdown requested reason=${reason}`
      ),
    catch: (cause) =>
      createRuntimeShutdownError({
        cause,
        code: "internal",
        message: `failed to record runtime shutdown request for ${reason}`,
        reason,
      }),
  });
  if (requestLogResult.isErr()) {
    return Result.err(requestLogResult.error);
  }

  const stoppingTransitionResult = await transitionShutdownPhase(args, {
    message: `failed to record runtime shutdown state for ${reason}`,
    phase: "stopping",
  });
  const drainingTransitionResult = await transitionShutdownPhase(args, {
    message: `failed to record runtime drain state for ${reason}`,
    phase: "draining",
  });
  const stopResult = await Result.tryPromise({
    try: async () => {
      await args.server.stop(true);
    },
    catch: (cause) =>
      createRuntimeShutdownError({
        cause,
        code: "shutdown_rejected",
        message: `failed to stop runtime server for ${reason}`,
        reason,
      }),
  });
  const checkpointingTransitionResult = await transitionShutdownPhase(args, {
    failureCode: "checkpoint_failed",
    message: `failed to record runtime storage checkpoint state for ${reason}`,
    phase: "checkpointing",
  });
  const closeResourcesResult = await closeShutdownResources(
    args.shutdownResources,
    reason
  );

  let releaseResult: ShutdownResult | null = null;
  let failedTransitionResult: ShutdownResult | null = null;
  const shutdownWorkSucceeded =
    stoppingTransitionResult.isOk() &&
    drainingTransitionResult.isOk() &&
    stopResult.isOk() &&
    checkpointingTransitionResult.isOk() &&
    closeResourcesResult.isOk();

  if (shutdownWorkSucceeded) {
    releaseResult = await Result.tryPromise({
      try: async () => {
        await args.lease.release({
          reason,
          stopServer: true,
        });
      },
      catch: (cause) =>
        createRuntimeShutdownError({
          cause,
          code: "internal",
          message: `failed to release lifecycle lease for ${reason}`,
          reason,
        }),
    });
  } else {
    const failure = selectShutdownFailure([
      stoppingTransitionResult,
      drainingTransitionResult,
      stopResult,
      checkpointingTransitionResult,
      closeResourcesResult,
    ]);
    failedTransitionResult = await transitionShutdownPhase(args, {
      failure,
      message: `failed to record runtime shutdown failure state for ${reason}`,
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
              `failed to shut down runtime for ${reason}`
            ),
      message: `failed to shut down runtime for ${reason}`,
      reason,
      failure: selectShutdownFailure([
        stoppingTransitionResult,
        drainingTransitionResult,
        stopResult,
        checkpointingTransitionResult,
        closeResourcesResult,
        ...(releaseResult ? [releaseResult] : []),
      ]),
    })
  );
}

async function transitionShutdownPhase(
  args: {
    lease: RuntimeLifecycleLease;
    request: RuntimeShutdownRequest;
  },
  transition: {
    failure?: RuntimeLifecycleFailure;
    failureCode?: RuntimeLifecycleFailureCode;
    message: string;
    phase: RuntimeLifecyclePhase;
  }
): Promise<ShutdownResult> {
  return Result.tryPromise({
    try: async () => {
      await args.lease.transition(transition.phase, transition.failure);
    },
    catch: (cause) =>
      createRuntimeShutdownError({
        cause,
        code: transition.failureCode ?? transition.failure?.code ?? "internal",
        message: transition.message,
        reason: args.request.reason,
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
        createRuntimeShutdownError({
          cause,
          code: resource.failureCode ?? "resource_close_failed",
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
      failure: selectShutdownFailure(errors.map((error) => Result.err(error))),
    })
  );
}

function selectShutdownFailure(
  results: readonly ShutdownResult[]
): RuntimeLifecycleFailure {
  for (const result of results) {
    if (result.isErr()) {
      return result.error.failure;
    }
  }

  return {
    code: "internal",
    message: "runtime shutdown failed without a classified cause",
    retryable: false,
  };
}
