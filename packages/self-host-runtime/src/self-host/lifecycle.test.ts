import { EventEmitter } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DuplicateRuntimeStartError,
  acquireRuntimeLifecycleLease,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
  toLifecyclePathsResult,
} from "./lifecycle";
import type { SelfHostLifecyclePaths } from "./lifecycle";

function createPaths(root: string): SelfHostLifecyclePaths & {
  runDir: string;
  serverLogPath: string;
  statePath: string;
} {
  const dataDir = join(root, "data");
  const logsDir = join(dataDir, "logs");
  const runDir = join(dataDir, "run");

  return {
    dataDir,
    lockPath: join(runDir, "server.lock"),
    logsDir,
    pidPath: join(runDir, "server.pid"),
    runDir,
    serverLogPath: join(logsDir, "server.log"),
    statePath: join(runDir, "server.state.json"),
  };
}

describe("self-host lifecycle lease", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) =>
        rm(root, {
          force: true,
          recursive: true,
        })
      )
    );
  });

  it("blocks a duplicate start for the same data directory while the lock holder is alive", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-self-host-lifecycle-"));
    tempRoots.push(root);
    const paths = createPaths(root);
    const logWriter = {
      append: vi.fn(async () => {}),
    };

    const firstLease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: (pid) => pid === 111,
      logWriter,
      pid: 111,
    });

    await expect(
      acquireRuntimeLifecycleLease(paths, {
        isProcessRunning: (pid) => pid === 111,
        logWriter,
        pid: 222,
      })
    ).rejects.toBeInstanceOf(DuplicateRuntimeStartError);

    await firstLease.release({
      reason: "test_cleanup",
      stopServer: false,
    });
  });

  it("replaces a stale lock before acquiring a new lifecycle lease", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-stale-lock-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);

    await mkdir(paths.runDir, {
      recursive: true,
    });
    await writeFile(
      paths.lockPath,
      JSON.stringify({
        pid: 999,
        acquiredAt: "2026-03-25T00:00:00.000Z",
        dataDir: paths.dataDir,
      })
    );
    await writeFile(paths.pidPath, "999\n");

    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      pid: 222,
    });
    const lockContents = await readFile(paths.lockPath, "utf8");

    expect(lockContents).toContain('"pid":222');

    await lease.release({
      reason: "test_cleanup",
      stopServer: false,
    });
  });

  it("records startup and shutdown lifecycle phases in the runtime state file", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-self-host-state-"));
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      now: () => new Date("2026-03-25T00:00:00.000Z"),
      pid: 333,
    });

    await expect(readFile(paths.statePath, "utf8")).resolves.toContain(
      '"phase":"starting"'
    );

    await lease.transition("ready");

    await expect(readFile(paths.statePath, "utf8")).resolves.toContain(
      '"phase":"ready"'
    );

    await lease.release({
      reason: "test_cleanup",
      stopServer: false,
    });

    await expect(access(paths.statePath)).rejects.toBeDefined();
  });

  it("stops the packaged server runtime and removes pid and lock files on SIGTERM", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-self-host-signal-"));
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      pid: 333,
    });
    const processSignals = new EventEmitter();
    let resolveServerStop = () => {};
    const serverStopPromise = new Promise<void>((resolve) => {
      resolveServerStop = resolve;
    });
    const events: string[] = [];
    const server = {
      stop: vi.fn(async () => {
        events.push("stop:start");
        await serverStopPromise;
        events.push("stop:done");
      }),
    };
    const exitProcess = vi.fn((code: number) => {
      events.push(`exit:${code}`);
    });
    const logWriter = {
      append: vi.fn(async () => {}),
    };

    attachGracefulShutdownHandlers({
      exitProcess,
      lease,
      logWriter,
      processSignals,
      server,
    });

    processSignals.emit("SIGTERM");
    processSignals.emit("SIGINT");

    await waitUntil(async () => {
      expect(server.stop).toHaveBeenCalledWith(true);
    });
    expect(exitProcess).not.toHaveBeenCalled();
    await access(paths.pidPath);
    await access(paths.lockPath);
    await expect(readFile(paths.statePath, "utf8")).resolves.toContain(
      '"phase":"stopping"'
    );

    resolveServerStop();

    await waitUntil(async () => {
      expect(exitProcess).toHaveBeenCalledWith(0);
      await expect(access(paths.pidPath)).rejects.toBeDefined();
      await expect(access(paths.lockPath)).rejects.toBeDefined();
      await expect(access(paths.statePath)).rejects.toBeDefined();
      expect(events).toEqual(["stop:start", "stop:done", "exit:0"]);
    });
  });

  it("releases the lifecycle lease and exits with failure when server shutdown errors", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-signal-failure-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      pid: 444,
    });
    const processSignals = new EventEmitter();
    const stopError = new Error("server close failed");
    const server = {
      stop: vi.fn(async () => {
        throw stopError;
      }),
    };
    const exitProcess = vi.fn();

    attachGracefulShutdownHandlers({
      exitProcess,
      lease,
      processSignals,
      server,
    });

    processSignals.emit("SIGTERM");

    await waitUntil(async () => {
      expect(server.stop).toHaveBeenCalledWith(true);
      expect(exitProcess).toHaveBeenCalledWith(1);
      await expect(access(paths.pidPath)).rejects.toBeDefined();
      await expect(access(paths.lockPath)).rejects.toBeDefined();
      await expect(access(paths.statePath)).rejects.toBeDefined();
    });
  });

  it("appends lifecycle log lines into the configured server log file", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-self-host-log-"));
    tempRoots.push(root);
    const paths = createPaths(root);

    await appendLifecycleLog(
      paths,
      "[onequery-server] listening on http://127.0.0.1:5656",
      () => new Date("2026-03-25T00:00:00.000Z")
    );

    await expect(readFile(paths.serverLogPath, "utf8")).resolves.toContain(
      "2026-03-25T00:00:00.000Z [onequery-server] listening on http://127.0.0.1:5656"
    );
  });

  it("returns an unmanaged lifecycle-path resolution for workspace-dev launch configs", () => {
    const result = toLifecyclePathsResult({
      mode: "workspace-dev",
      runtimePaths: undefined,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual({
      kind: "unmanaged",
    });
  });

  it("returns a self-host lifecycle-path resolution when runtime paths are present", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-path-resolution-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);

    const result = toLifecyclePathsResult({
      mode: "self-host",
      runtimePaths: {
        backupsDir: join(root, "backups"),
        dataDir: paths.dataDir,
        lockPath: paths.lockPath,
        logsDir: paths.logsDir,
        pidPath: paths.pidPath,
        runDir: paths.runDir,
      },
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value).toEqual({
      kind: "self-host",
      paths: {
        dataDir: paths.dataDir,
        lockPath: paths.lockPath,
        logsDir: paths.logsDir,
        pidPath: paths.pidPath,
      },
    });
  });

  it("replaces an invalid lock record before acquiring a new lifecycle lease", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-invalid-lock-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);

    await mkdir(paths.runDir, {
      recursive: true,
    });
    await writeFile(
      paths.lockPath,
      JSON.stringify({
        acquiredAt: "2026-03-25T00:00:00.000Z",
        dataDir: paths.dataDir,
        pid: "invalid",
      })
    );
    await writeFile(paths.pidPath, "999\n");

    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      pid: 555,
    });

    await expect(readFile(paths.lockPath, "utf8")).resolves.toContain(
      '"pid":555'
    );

    await lease.release({
      reason: "test_cleanup",
      stopServer: false,
    });
  });
});

async function waitUntil(
  assertion: () => Promise<void>,
  attempts = 25
): Promise<void> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "waitUntil timed out"));
}
