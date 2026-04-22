import {
  appendFile,
  mkdir,
  open,
  readFile,
  rm,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { panic, unreachable } from "antiox/panic";
import { channel } from "antiox/sync/mpsc";
import type { Sender } from "antiox/sync/mpsc";
import { oneshot } from "antiox/sync/oneshot";
import type { OneshotSender } from "antiox/sync/oneshot";
import { spawn } from "antiox/task";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

export interface SelfHostLifecyclePaths {
  dataDir: string;
  lockPath: string;
  logsDir: string;
  pidPath: string;
}

export class DuplicateRuntimeStartError extends TaggedError(
  "DuplicateRuntimeStartError"
)<{
  dataDir: string;
  existingPid: number | null;
  message: string;
}>() {
  constructor(paths: SelfHostLifecyclePaths, existingPid: number | null) {
    super({
      dataDir: paths.dataDir,
      existingPid,
      message:
        existingPid === null
          ? `Self-host runtime is already locked for ${paths.dataDir}`
          : `Self-host runtime already running for ${paths.dataDir} (pid ${existingPid})`,
    });
  }
}

class RuntimeLifecycleDirectoryError extends TaggedError(
  "RuntimeLifecycleDirectoryError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

class RuntimeLifecycleFileError extends TaggedError(
  "RuntimeLifecycleFileError"
)<{
  cause: unknown;
  message: string;
  operation:
    | "append"
    | "close"
    | "open"
    | "read"
    | "remove"
    | "rename"
    | "write";
  path: string;
}>() {}

class RuntimeLifecycleLogWriteError extends TaggedError(
  "RuntimeLifecycleLogWriteError"
)<{
  cause: unknown;
  message: string;
}>() {}

class RuntimeLockRecordReadError extends TaggedError(
  "RuntimeLockRecordReadError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

export class RuntimeShutdownError extends TaggedError("RuntimeShutdownError")<{
  cause: unknown;
  message: string;
  reason: string;
}>() {}

export class SelfHostRuntimePathsMissingError extends TaggedError(
  "SelfHostRuntimePathsMissingError"
)<{
  message: string;
}>() {}

export type LifecyclePathsResolution =
  | {
      kind: "self-host";
      paths: SelfHostLifecyclePaths;
    }
  | {
      kind: "unmanaged";
    };

interface LifecycleLogWriter {
  append(message: string): Promise<void>;
}

interface ProcessSignalSource {
  off(event: "SIGINT" | "SIGTERM", listener: () => void): this;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): this;
}

interface ServerHandle {
  stop(closeActiveConnections?: boolean): Promise<void> | void;
}

interface RuntimeLockRecord {
  pid: number;
  acquiredAt: string;
  dataDir: string;
}

interface RuntimeStateRecord {
  pid: number;
  phase: RuntimeLifecyclePhase;
  updatedAt: string;
  dataDir: string;
}

interface LifecycleOptions {
  isProcessRunning?: (pid: number) => boolean;
  logWriter?: LifecycleLogWriter;
  now?: () => Date;
  pid?: number;
}

interface CleanupOptions {
  reason: string;
  stopServer: boolean;
}

export type RuntimeLifecyclePhase = "starting" | "ready" | "stopping";

export interface RuntimeLifecycleLease {
  paths: SelfHostLifecyclePaths;
  transition(phase: RuntimeLifecyclePhase): Promise<void>;
  release(options: CleanupOptions): Promise<void>;
}

export interface GracefulShutdownController {
  dispose(): void;
  shutdown(reason: string): Promise<void>;
}

type AppendLifecycleLogError =
  | RuntimeLifecycleDirectoryError
  | RuntimeLifecycleFileError;

type AcquireRuntimeLifecycleLeaseError =
  | DuplicateRuntimeStartError
  | RuntimeLifecycleDirectoryError
  | RuntimeLifecycleFileError
  | RuntimeLifecycleLogWriteError
  | RuntimeLockRecordReadError;

type RuntimeLifecycleMutationError =
  | RuntimeLifecycleFileError
  | RuntimeLifecycleLogWriteError;

type ShutdownResult = ResultType<void, RuntimeShutdownError>;

type ShutdownCompletion = "cleanup_only" | "cleanup_and_exit";

type ShutdownMachineEvent =
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

type ShutdownMachineState =
  | {
      status: "idle";
    }
  | {
      status: "shutting_down";
      completion: ShutdownCompletion;
      reason: string;
      responders: OneshotSender<ShutdownResult>[];
    }
  | {
      status: "finished";
      exitHandled: boolean;
      result: ShutdownResult;
    };

type ShutdownMachineEffect =
  | {
      type: "exit";
      code: 0 | 1;
    }
  | {
      type: "respond";
      responders: OneshotSender<ShutdownResult>[];
      result: ShutdownResult;
    }
  | {
      type: "start_shutdown";
      reason: string;
    };

const defaultLifecycleOptions: Required<LifecycleOptions> = {
  isProcessRunning: defaultIsProcessRunning,
  logWriter: { append: async () => {} },
  now: () => new Date(),
  pid: process.pid,
};

export async function acquireRuntimeLifecycleLeaseResult(
  paths: SelfHostLifecyclePaths,
  options: LifecycleOptions = {}
): Promise<
  ResultType<RuntimeLifecycleLease, AcquireRuntimeLifecycleLeaseError>
> {
  const resolved: Required<LifecycleOptions> = {
    ...defaultLifecycleOptions,
    ...options,
  };
  let lockRecord: RuntimeLockRecord | null = null;

  const acquisition = await Result.gen(async function* acquireLeaseFlow() {
    yield* Result.await(ensureRuntimeDirectories(paths));
    lockRecord = yield* Result.await(acquireLock(paths, resolved));
    yield* Result.await(
      writeRuntimeState(
        paths,
        createRuntimeStateRecord(lockRecord, "starting", resolved.now)
      )
    );
    yield* Result.await(
      writeLifecycleFile(
        paths.pidPath,
        `${lockRecord.pid}\n`,
        "write",
        `failed to write runtime pid file at ${paths.pidPath}`,
        {
          encoding: "utf8",
        }
      )
    );
    yield* Result.await(
      writeLogMessage(
        resolved.logWriter,
        `[runtime] acquired lifecycle lease pid=${lockRecord.pid} dataDir=${paths.dataDir}`
      )
    );
    const activeLockRecord = lockRecord;

    let released = false;

    return Result.ok({
      paths,
      async transition(phase) {
        const transitionResult = await transitionRuntimeLifecycleLease(
          paths,
          activeLockRecord,
          phase,
          resolved.now
        );

        if (transitionResult.isErr()) {
          throw transitionResult.error;
        }
      },
      async release({ reason, stopServer }) {
        if (released) {
          return;
        }

        released = true;
        const releaseResult = await releaseRuntimeLifecycleLease(
          paths,
          activeLockRecord,
          resolved.logWriter,
          {
            reason,
            stopServer,
          }
        );

        if (releaseResult.isErr()) {
          throw releaseResult.error;
        }
      },
    } satisfies RuntimeLifecycleLease);
  });
  if (acquisition.isErr() && lockRecord !== null) {
    await cleanupLeaseArtifacts(paths);
  }

  return acquisition;
}

export async function acquireRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  options: LifecycleOptions = {}
): Promise<RuntimeLifecycleLease> {
  const lease = await acquireRuntimeLifecycleLeaseResult(paths, options);

  if (lease.isErr()) {
    throw lease.error;
  }

  return lease.value;
}

export function attachGracefulShutdownHandlers(args: {
  exitProcess?: (code: number) => void;
  lease: RuntimeLifecycleLease;
  processSignals?: ProcessSignalSource;
  server: ServerHandle;
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

  void spawn(async () => {
    let state: ShutdownMachineState = {
      status: "idle",
    };

    for await (const event of eventRx) {
      const transition = reduceShutdownMachine(state, event);
      state = transition.state;
      runShutdownMachineEffects(transition.effects, {
        eventTx,
        executeShutdown: (reason) =>
          executeShutdown({
            lease: args.lease,
            logWriter,
            reason,
            server: args.server,
          }),
        exitProcess,
      });
    }
  });

  const requestShutdown = async (
    reason: string,
    completion: ShutdownCompletion = "cleanup_only"
  ) => {
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
    },
    shutdown(reason: string) {
      return requestShutdown(reason);
    },
  };
}

export async function appendLifecycleLogResult(
  paths: SelfHostLifecyclePaths,
  message: string,
  now: () => Date = () => new Date()
): Promise<ResultType<void, AppendLifecycleLogError>> {
  const ensureLogsDirResult = await ensureRuntimeDirectory(paths.logsDir);
  if (ensureLogsDirResult.isErr()) {
    return Result.err(ensureLogsDirResult.error);
  }

  return appendLifecycleFile(
    join(paths.logsDir, "server.log"),
    `${formatTimestamp(now())} ${message}\n`,
    `failed to append lifecycle log at ${join(paths.logsDir, "server.log")}`
  );
}

export async function appendLifecycleLog(
  paths: SelfHostLifecyclePaths,
  message: string,
  now: () => Date = () => new Date()
): Promise<void> {
  const appendResult = await appendLifecycleLogResult(paths, message, now);

  if (appendResult.isErr()) {
    throw appendResult.error;
  }
}

export function toLifecyclePathsResult(
  launchConfig: Pick<ServerLaunchConfig, "mode" | "runtimePaths">
): ResultType<LifecyclePathsResolution, SelfHostRuntimePathsMissingError> {
  if (launchConfig.mode !== "self-host") {
    return Result.ok({
      kind: "unmanaged",
    });
  }

  if (!launchConfig.runtimePaths) {
    return Result.err(
      new SelfHostRuntimePathsMissingError({
        message: "Self-host launch config requires runtimePaths.",
      })
    );
  }

  return Result.ok({
    kind: "self-host",
    paths: {
      dataDir: launchConfig.runtimePaths.dataDir,
      lockPath: launchConfig.runtimePaths.lockPath,
      logsDir: launchConfig.runtimePaths.logsDir,
      pidPath: launchConfig.runtimePaths.pidPath,
    },
  });
}

export function toLifecyclePaths(
  launchConfig: Pick<ServerLaunchConfig, "mode" | "runtimePaths">
): LifecyclePathsResolution {
  const paths = toLifecyclePathsResult(launchConfig);

  if (paths.isErr()) {
    throw paths.error;
  }

  return paths.value;
}

async function executeShutdown(args: {
  lease: RuntimeLifecycleLease;
  logWriter: LifecycleLogWriter;
  reason: string;
  server: ServerHandle;
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

  const transitionResult = await Result.tryPromise({
    try: async () => {
      await args.lease.transition("stopping");
    },
    catch: (cause) =>
      new RuntimeShutdownError({
        cause,
        message: `failed to record runtime shutdown state for ${args.reason}`,
        reason: args.reason,
      }),
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
  const releaseResult = await Result.tryPromise({
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

  if (transitionResult.isOk() && stopResult.isOk() && releaseResult.isOk()) {
    return Result.ok(undefined);
  }

  const causes = [
    transitionResult.isErr() ? transitionResult.error.cause : null,
    stopResult.isErr() ? stopResult.error.cause : null,
    releaseResult.isErr() ? releaseResult.error.cause : null,
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

function reduceShutdownMachine(
  state: ShutdownMachineState,
  event: ShutdownMachineEvent
): {
  effects: ShutdownMachineEffect[];
  state: ShutdownMachineState;
} {
  switch (state.status) {
    case "idle": {
      switch (event.type) {
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
              reason: event.reason,
              responders: [event.responseTx],
            },
          };
        case "shutdown_finished":
          return panic("shutdown_finished without an active shutdown request");
        default:
          return unreachable(event);
      }
    }
    case "shutting_down": {
      switch (event.type) {
        case "shutdown_requested":
          return {
            effects: [],
            state: {
              ...state,
              completion:
                state.completion === "cleanup_and_exit"
                  ? state.completion
                  : event.completion,
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
            ],
            state: {
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
    default:
      return unreachable(state);
  }
}

function runShutdownMachineEffects(
  effects: readonly ShutdownMachineEffect[],
  args: {
    eventTx: Sender<ShutdownMachineEvent>;
    executeShutdown(reason: string): Promise<ShutdownResult>;
    exitProcess(code: number): void;
  }
): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "start_shutdown":
        void spawn(async () => {
          const result = await args.executeShutdown(effect.reason);
          await Result.tryPromise({
            try: () =>
              args.eventTx.send({
                type: "shutdown_finished",
                result,
              }),
            catch: () => undefined,
          });
        });
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

async function transitionRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  lockRecord: RuntimeLockRecord,
  phase: RuntimeLifecyclePhase,
  now: () => Date
): Promise<ResultType<void, RuntimeLifecycleMutationError>> {
  return writeRuntimeState(
    paths,
    createRuntimeStateRecord(lockRecord, phase, now)
  );
}

async function releaseRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  lockRecord: RuntimeLockRecord,
  logWriter: LifecycleLogWriter,
  options: CleanupOptions
): Promise<ResultType<void, RuntimeLifecycleMutationError>> {
  return Result.gen(async function* releaseLeaseFlow() {
    yield* Result.await(
      writeLogMessage(
        logWriter,
        `[runtime] releasing lifecycle lease pid=${lockRecord.pid} reason=${options.reason} stopServer=${options.stopServer ? "yes" : "no"}`
      )
    );
    const [removeRuntimeStateResult, removePidResult] = await Promise.all([
      removeIfPresent(runtimeStatePath(paths)),
      removeIfPresent(paths.pidPath),
    ]);

    yield* removeRuntimeStateResult;
    yield* removePidResult;
    yield* Result.await(removeIfPresent(paths.lockPath));

    return Result.ok(undefined);
  });
}

async function ensureRuntimeDirectories(
  paths: SelfHostLifecyclePaths
): Promise<ResultType<void, RuntimeLifecycleDirectoryError>> {
  const ensurePathResults = await Promise.all(
    [
      ...new Set([
        paths.dataDir,
        paths.logsDir,
        dirname(paths.pidPath),
        dirname(paths.lockPath),
      ]),
    ].map((path) => ensureRuntimeDirectory(path))
  );

  for (const ensurePathResult of ensurePathResults) {
    if (ensurePathResult.isErr()) {
      return Result.err(ensurePathResult.error);
    }
  }

  return Result.ok(undefined);
}

async function ensureRuntimeDirectory(
  path: string
): Promise<ResultType<void, RuntimeLifecycleDirectoryError>> {
  return Result.tryPromise({
    try: async () =>
      mkdir(path, {
        recursive: true,
        mode: 0o700,
      }),
    catch: (cause) =>
      new RuntimeLifecycleDirectoryError({
        cause,
        message: `failed to ensure runtime directory ${path}`,
        path,
      }),
  }).then((result) => result.map(() => undefined));
}

async function acquireLock(
  paths: SelfHostLifecyclePaths,
  options: Required<LifecycleOptions>
): Promise<ResultType<RuntimeLockRecord, AcquireRuntimeLifecycleLeaseError>> {
  const record: RuntimeLockRecord = {
    pid: options.pid,
    acquiredAt: options.now().toISOString(),
    dataDir: paths.dataDir,
  };

  const initialWriteResult = await writeNewLock(paths.lockPath, record);
  if (initialWriteResult.isOk()) {
    return Result.ok(record);
  }

  if (!isAlreadyExistsLifecycleError(initialWriteResult.error)) {
    return Result.err(initialWriteResult.error);
  }

  const existingRecord = await readLockRecord(paths.lockPath);
  if (
    existingRecord.isOk() &&
    options.isProcessRunning(existingRecord.value.pid)
  ) {
    const duplicateLogResult = await writeLogMessage(
      options.logWriter,
      `[runtime] duplicate start blocked pid=${existingRecord.value.pid} dataDir=${paths.dataDir}`
    );
    if (duplicateLogResult.isErr()) {
      return Result.err(duplicateLogResult.error);
    }

    return Result.err(
      new DuplicateRuntimeStartError(paths, existingRecord.value.pid)
    );
  }

  const staleLockLogResult = await writeLogMessage(
    options.logWriter,
    `[runtime] removing stale lifecycle lock dataDir=${paths.dataDir} existingPid=${existingRecord.isOk() ? existingRecord.value.pid : "unknown"}`
  );
  if (staleLockLogResult.isErr()) {
    return Result.err(staleLockLogResult.error);
  }

  const [removeLockResult, removePidResult] = await Promise.all([
    removeIfPresent(paths.lockPath),
    removeIfPresent(paths.pidPath),
  ]);
  if (removeLockResult.isErr()) {
    return Result.err(removeLockResult.error);
  }
  if (removePidResult.isErr()) {
    return Result.err(removePidResult.error);
  }

  const replacementWriteResult = await writeNewLock(paths.lockPath, record);
  if (replacementWriteResult.isErr()) {
    return Result.err(replacementWriteResult.error);
  }

  return Result.ok(record);
}

async function writeNewLock(
  path: string,
  record: RuntimeLockRecord
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  const handleResult = await Result.tryPromise({
    try: async () => open(path, "wx", 0o600),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to create runtime lock file at ${path}`,
        operation: "open",
        path,
      }),
  });
  if (handleResult.isErr()) {
    return Result.err(handleResult.error);
  }

  const handle = handleResult.value;
  const writeResult = await Result.tryPromise({
    try: async () => handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to write runtime lock file at ${path}`,
        operation: "write",
        path,
      }),
  });
  const closeResult = await Result.tryPromise({
    try: async () => handle.close(),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to close runtime lock file at ${path}`,
        operation: "close",
        path,
      }),
  });

  if (writeResult.isErr()) {
    return Result.err(writeResult.error);
  }
  if (closeResult.isErr()) {
    return Result.err(closeResult.error);
  }

  return Result.ok(undefined);
}

async function readLockRecord(
  path: string
): Promise<
  ResultType<
    RuntimeLockRecord,
    RuntimeLifecycleFileError | RuntimeLockRecordReadError
  >
> {
  return Result.gen(async function* readLockRecordFlow() {
    const contents = yield* Result.await(
      Result.tryPromise({
        try: async () => readFile(path, "utf8"),
        catch: (cause) =>
          new RuntimeLifecycleFileError({
            cause,
            message: `failed to read runtime lock record at ${path}`,
            operation: "read",
            path,
          }),
      })
    );
    const parsed = yield* Result.try({
      try: () => JSON.parse(contents),
      catch: (cause) =>
        new RuntimeLockRecordReadError({
          cause,
          message: `invalid runtime lock record at ${path}`,
          path,
        }),
    });

    return decodeRuntimeLockRecord(parsed, path);
  });
}

function decodeRuntimeLockRecord(
  value: unknown,
  path: string
): ResultType<RuntimeLockRecord, RuntimeLockRecordReadError> {
  if (typeof value !== "object" || value === null) {
    return Result.err(
      new RuntimeLockRecordReadError({
        cause: value,
        message: `invalid runtime lock record at ${path}`,
        path,
      })
    );
  }
  if (
    !("pid" in value) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid)
  ) {
    return Result.err(
      new RuntimeLockRecordReadError({
        cause: value,
        message: `invalid runtime lock record at ${path}`,
        path,
      })
    );
  }
  if (!("acquiredAt" in value) || typeof value.acquiredAt !== "string") {
    return Result.err(
      new RuntimeLockRecordReadError({
        cause: value,
        message: `invalid runtime lock record at ${path}`,
        path,
      })
    );
  }
  if (!("dataDir" in value) || typeof value.dataDir !== "string") {
    return Result.err(
      new RuntimeLockRecordReadError({
        cause: value,
        message: `invalid runtime lock record at ${path}`,
        path,
      })
    );
  }

  return Result.ok({
    pid: value.pid,
    acquiredAt: value.acquiredAt,
    dataDir: value.dataDir,
  });
}

function defaultIsProcessRunning(pid: number): boolean {
  return Result.try(() => process.kill(pid, 0)).isOk();
}

function formatTimestamp(value: Date): string {
  return value.toISOString();
}

function createRuntimeStateRecord(
  lockRecord: RuntimeLockRecord,
  phase: RuntimeLifecyclePhase,
  now: () => Date
): RuntimeStateRecord {
  return {
    pid: lockRecord.pid,
    phase,
    updatedAt: now().toISOString(),
    dataDir: lockRecord.dataDir,
  };
}

function isAlreadyExistsLifecycleError(
  error: RuntimeLifecycleFileError
): boolean {
  return isAlreadyExistsError(error.cause);
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function runtimeStatePath(paths: SelfHostLifecyclePaths): string {
  return join(dirname(paths.lockPath), "server.state.json");
}

async function writeRuntimeState(
  paths: SelfHostLifecyclePaths,
  record: RuntimeStateRecord
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return replaceFileWithCompleteContents(
    runtimeStatePath(paths),
    `${JSON.stringify(record)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
}

async function replaceFileWithCompleteContents(
  path: string,
  contents: string,
  options: {
    encoding: "utf8";
    mode: number;
  }
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);

  const writeTempResult = await writeLifecycleFile(
    tempPath,
    contents,
    "write",
    `failed to write temp lifecycle file at ${tempPath}`,
    options
  );
  if (writeTempResult.isErr()) {
    return Result.err(writeTempResult.error);
  }

  const initialRenameResult = await renameLifecycleFile(
    tempPath,
    path,
    `failed to replace lifecycle file at ${path}`
  );
  if (initialRenameResult.isOk()) {
    return Result.ok(undefined);
  }

  // Comment: rewrite through a sibling temp file so readers never observe a
  // truncated JSON document while the runtime updates lifecycle state.
  const removeTargetResult = await removeIfPresent(path);
  if (removeTargetResult.isErr()) {
    return Result.err(removeTargetResult.error);
  }

  const replacementRenameResult = await renameLifecycleFile(
    tempPath,
    path,
    `failed to replace lifecycle file at ${path}`
  );
  if (replacementRenameResult.isErr()) {
    await removeIfPresent(tempPath);
    return Result.err(replacementRenameResult.error);
  }

  return Result.ok(undefined);
}

async function writeLifecycleFile(
  path: string,
  contents: string,
  operation: RuntimeLifecycleFileError["operation"],
  message: string,
  options: {
    encoding: "utf8";
    mode?: number;
  }
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => writeFile(path, contents, options),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message,
        operation,
        path,
      }),
  }).then((result) => result.map(() => undefined));
}

async function appendLifecycleFile(
  path: string,
  contents: string,
  message: string
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => appendFile(path, contents, "utf8"),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message,
        operation: "append",
        path,
      }),
  }).then((result) => result.map(() => undefined));
}

async function renameLifecycleFile(
  fromPath: string,
  toPath: string,
  message: string
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => rename(fromPath, toPath),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message,
        operation: "rename",
        path: toPath,
      }),
  }).then((result) => result.map(() => undefined));
}

async function removeIfPresent(
  path: string
): Promise<ResultType<void, RuntimeLifecycleFileError>> {
  return Result.tryPromise({
    try: async () => rm(path, { force: true }),
    catch: (cause) =>
      new RuntimeLifecycleFileError({
        cause,
        message: `failed to remove lifecycle file at ${path}`,
        operation: "remove",
        path,
      }),
  }).then((result) => result.map(() => undefined));
}

async function writeLogMessage(
  logWriter: LifecycleLogWriter,
  message: string
): Promise<ResultType<void, RuntimeLifecycleLogWriteError>> {
  return Result.tryPromise({
    try: async () => {
      await logWriter.append(message);
    },
    catch: (cause) =>
      new RuntimeLifecycleLogWriteError({
        cause,
        message: `failed to append lifecycle log line: ${message}`,
      }),
  }).then((result) => result.map(() => undefined));
}

async function cleanupLeaseArtifacts(
  paths: SelfHostLifecyclePaths
): Promise<void> {
  await Promise.all([
    removeIfPresent(runtimeStatePath(paths)),
    removeIfPresent(paths.pidPath),
  ]);
  await removeIfPresent(paths.lockPath);
}
