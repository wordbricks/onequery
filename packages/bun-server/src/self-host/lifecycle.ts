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

interface BunServerHandle {
  stop(closeActiveConnections?: boolean): void;
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

export interface GracefulShutdownController {
  shutdown(reason: string): Promise<void>;
}

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
  lease: RuntimeLifecycleLease;
  processSignals?: ProcessSignalSource;
  server: BunServerHandle;
  logWriter?: LifecycleLogWriter;
}): GracefulShutdownController {
  const processSignals = args.processSignals ?? process;
  const logWriter = args.logWriter ?? { append: async () => {} };
  let shuttingDown: Promise<void> | null = null;

  const shutdown = async (reason: string) => {
    if (shuttingDown) {
      return shuttingDown;
    }

    shuttingDown = (async () => {
      await logWriter.append(
        `[runtime] graceful shutdown requested reason=${reason}`
      );
      args.server.stop(true);
      await args.lease.release({
        reason,
        stopServer: true,
      });
    })();

    return shuttingDown;
  };

  processSignals.once("SIGINT", () => {
    shutdown("SIGINT").catch(() => undefined);
  });
  processSignals.once("SIGTERM", () => {
    shutdown("SIGTERM").catch(() => undefined);
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

    const existing = await readLockRecord(paths.lockPath);
    if (existing && options.isProcessRunning(existing.pid)) {
      await options.logWriter.append(
        `[runtime] duplicate start blocked pid=${existing.pid} dataDir=${paths.dataDir}`
      );
      throw new DuplicateRuntimeStartError(paths, existing.pid);
    }

    await options.logWriter.append(
      `[runtime] removing stale lifecycle lock dataDir=${paths.dataDir} existingPid=${existing?.pid ?? "unknown"}`
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

async function readLockRecord(path: string): Promise<RuntimeLockRecord | null> {
  try {
    const contents = await readFile(path, "utf8");
    const parsed = JSON.parse(contents) as Partial<RuntimeLockRecord>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      typeof parsed.acquiredAt === "string" &&
      typeof parsed.dataDir === "string"
    ) {
      return {
        pid: parsed.pid,
        acquiredAt: parsed.acquiredAt,
        dataDir: parsed.dataDir,
      };
    }
  } catch {
    return null;
  }

  return null;
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
