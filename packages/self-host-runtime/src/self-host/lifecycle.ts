import {
  appendFile,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

export interface SelfHostLifecyclePaths {
  dataDir: string;
  lockPath: string;
  logsDir: string;
  pidPath: string;
}

export class DuplicateRuntimeStartError extends Error {
  readonly dataDir: string;
  readonly existingPid: number | null;

  constructor(paths: SelfHostLifecyclePaths, existingPid: number | null) {
    super(
      existingPid === null
        ? `Self-host runtime is already locked for ${paths.dataDir}`
        : `Self-host runtime already running for ${paths.dataDir} (pid ${existingPid})`
    );
    this.name = "DuplicateRuntimeStartError";
    this.dataDir = paths.dataDir;
    this.existingPid = existingPid;
  }
}

interface LifecycleLogWriter {
  append(message: string): Promise<void>;
}

interface ProcessSignalSource {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): this;
  pid?: number;
}

interface ServerHandle {
  stop(closeActiveConnections?: boolean): Promise<void> | void;
}

interface RuntimeLockRecord {
  pid: number;
  acquiredAt: string;
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
  stopServer?: boolean;
}

export interface RuntimeLifecycleLease {
  paths: SelfHostLifecyclePaths;
  release(options: CleanupOptions): Promise<void>;
}

interface GracefulShutdownController {
  shutdown(reason: string): Promise<void>;
}

class RuntimeLockRecordReadError extends TaggedError(
  "RuntimeLockRecordReadError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

class RuntimeShutdownError extends TaggedError("RuntimeShutdownError")<{
  cause: unknown;
  message: string;
  reason: string;
}>() {}

type ShutdownResult = ResultType<void, RuntimeShutdownError>;

type ShutdownState = {
  completion: "cleanup_only" | "cleanup_and_exit";
  exitScheduled: boolean;
  result: Promise<ShutdownResult>;
};

const defaultLifecycleOptions: Required<LifecycleOptions> = {
  isProcessRunning: defaultIsProcessRunning,
  logWriter: { append: async () => {} },
  now: () => new Date(),
  pid: process.pid,
};

export async function acquireRuntimeLifecycleLease(
  paths: SelfHostLifecyclePaths,
  options: LifecycleOptions = {}
): Promise<RuntimeLifecycleLease> {
  const resolved = {
    ...defaultLifecycleOptions,
    ...options,
  };

  await ensureRuntimeDirectories(paths);
  const lockRecord = await acquireLock(paths, resolved);
  await writeFile(paths.pidPath, `${lockRecord.pid}\n`, "utf8");
  await resolved.logWriter.append(
    `[runtime] acquired lifecycle lease pid=${lockRecord.pid} dataDir=${paths.dataDir}`
  );

  let released = false;

  return {
    paths,
    async release({ reason, stopServer }) {
      if (released) {
        return;
      }

      released = true;
      await resolved.logWriter.append(
        `[runtime] releasing lifecycle lease pid=${lockRecord.pid} reason=${reason} stopServer=${stopServer ? "yes" : "no"}`
      );
      await removeIfPresent(paths.pidPath);
      await removeIfPresent(paths.lockPath);
    },
  };
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
  let shutdownState: ShutdownState | null = null;

  const executeShutdown = async (reason: string): Promise<ShutdownResult> => {
    await logWriter.append(
      `[runtime] graceful shutdown requested reason=${reason}`
    );

    const stopResult = await Result.tryPromise({
      try: async () => {
        await args.server.stop(true);
      },
      catch: (cause) =>
        new RuntimeShutdownError({
          cause,
          message: `failed to stop runtime server for ${reason}`,
          reason,
        }),
    });
    const releaseResult = await Result.tryPromise({
      try: async () => {
        await args.lease.release({
          reason,
          stopServer: true,
        });
      },
      catch: (cause) =>
        new RuntimeShutdownError({
          cause,
          message: `failed to release lifecycle lease for ${reason}`,
          reason,
        }),
    });

    if (stopResult.isOk() && releaseResult.isOk()) {
      return Result.ok(undefined);
    }

    const causes = [
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
                `failed to shut down runtime for ${reason}`
              ),
        message: `failed to shut down runtime for ${reason}`,
        reason,
      })
    );
  };

  const scheduleExit = (state: ShutdownState) => {
    if (state.exitScheduled) {
      return;
    }

    state.exitScheduled = true;
    void state.result.then((result) => {
      // Comment: keep one shutdown state so signal-driven exits and direct
      // cleanup callers converge on the same lease-release path.
      exitProcess(result.isOk() ? 0 : 1);
    });
  };

  const shutdown = (
    reason: string,
    completion: ShutdownState["completion"] = "cleanup_only"
  ) => {
    if (!shutdownState) {
      shutdownState = {
        completion,
        exitScheduled: false,
        result: executeShutdown(reason),
      };
    } else if (completion === "cleanup_and_exit") {
      shutdownState.completion = "cleanup_and_exit";
    }

    if (shutdownState.completion === "cleanup_and_exit") {
      scheduleExit(shutdownState);
    }

    return shutdownState.result.then((result) => {
      if (result.isOk()) {
        return;
      }

      throw result.error;
    });
  };

  const requestShutdown = (reason: "SIGINT" | "SIGTERM") => {
    void shutdown(reason, "cleanup_and_exit").catch(() => undefined);
  };

  processSignals.once("SIGINT", () => {
    requestShutdown("SIGINT");
  });
  processSignals.once("SIGTERM", () => {
    requestShutdown("SIGTERM");
  });

  return {
    shutdown,
  };
}

export async function appendLifecycleLog(
  paths: SelfHostLifecyclePaths,
  message: string,
  now: () => Date = () => new Date()
): Promise<void> {
  await mkdir(paths.logsDir, { recursive: true });
  await appendFile(
    join(paths.logsDir, "server.log"),
    `${formatTimestamp(now())} ${message}\n`,
    "utf8"
  );
}

async function ensureRuntimeDirectories(
  paths: SelfHostLifecyclePaths
): Promise<void> {
  await Promise.all(
    [
      paths.dataDir,
      paths.logsDir,
      dirname(paths.pidPath),
      dirname(paths.lockPath),
    ].map((path) =>
      mkdir(path, {
        recursive: true,
        mode: 0o700,
      })
    )
  );
}

async function acquireLock(
  paths: SelfHostLifecyclePaths,
  options: Required<LifecycleOptions>
): Promise<RuntimeLockRecord> {
  const record: RuntimeLockRecord = {
    pid: options.pid,
    acquiredAt: options.now().toISOString(),
    dataDir: paths.dataDir,
  };

  try {
    await writeNewLock(paths.lockPath, record);
    return record;
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    const existingRecord = await readLockRecord(paths.lockPath);
    if (
      existingRecord.isOk() &&
      options.isProcessRunning(existingRecord.value.pid)
    ) {
      await options.logWriter.append(
        `[runtime] duplicate start blocked pid=${existingRecord.value.pid} dataDir=${paths.dataDir}`
      );
      throw new DuplicateRuntimeStartError(paths, existingRecord.value.pid);
    }

    await options.logWriter.append(
      `[runtime] removing stale lifecycle lock dataDir=${paths.dataDir} existingPid=${existingRecord.isOk() ? existingRecord.value.pid : "unknown"}`
    );
    await removeIfPresent(paths.lockPath);
    await removeIfPresent(paths.pidPath);
    await writeNewLock(paths.lockPath, record);
    return record;
  }
}

async function writeNewLock(
  path: string,
  record: RuntimeLockRecord
): Promise<void> {
  const handle = await open(path, "wx", 0o600);

  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
  } finally {
    await handle.close();
  }
}

async function readLockRecord(
  path: string
): Promise<ResultType<RuntimeLockRecord, RuntimeLockRecordReadError>> {
  const contents = await Result.tryPromise({
    try: async () => readFile(path, "utf8"),
    catch: (cause) =>
      new RuntimeLockRecordReadError({
        cause,
        message: `failed to read runtime lock record at ${path}`,
        path,
      }),
  });
  if (contents.isErr()) {
    return Result.err(contents.error);
  }

  const parsed = Result.try({
    try: () => JSON.parse(contents.value) as Partial<RuntimeLockRecord>,
    catch: (cause) =>
      new RuntimeLockRecordReadError({
        cause,
        message: `invalid runtime lock record at ${path}`,
        path,
      }),
  });
  if (parsed.isErr()) {
    return Result.err(parsed.error);
  }

  if (
    typeof parsed.value.pid !== "number" ||
    !Number.isInteger(parsed.value.pid) ||
    typeof parsed.value.acquiredAt !== "string" ||
    typeof parsed.value.dataDir !== "string"
  ) {
    return Result.err(
      new RuntimeLockRecordReadError({
        cause: parsed.value,
        message: `invalid runtime lock record at ${path}`,
        path,
      })
    );
  }

  return Result.ok({
    pid: parsed.value.pid,
    acquiredAt: parsed.value.acquiredAt,
    dataDir: parsed.value.dataDir,
  });
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatTimestamp(value: Date): string {
  return value.toISOString();
}

export function toLifecyclePaths(
  launchConfig: Pick<ServerLaunchConfig, "mode" | "runtimePaths">
): SelfHostLifecyclePaths | null {
  if (launchConfig.mode !== "self-host") {
    return null;
  }

  if (!launchConfig.runtimePaths) {
    throw new Error("Self-host launch config requires runtimePaths.");
  }

  return {
    dataDir: launchConfig.runtimePaths.dataDir,
    lockPath: launchConfig.runtimePaths.lockPath,
    logsDir: launchConfig.runtimePaths.logsDir,
    pidPath: launchConfig.runtimePaths.pidPath,
  };
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // Ignore cleanup failures during shutdown; later status/log inspection can surface leftovers.
  }
}
