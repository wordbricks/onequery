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
} from "./lifecycle";
import type { SelfHostRuntimePaths } from "./paths";

function createPaths(root: string): SelfHostRuntimePaths {
  return {
    configDir: join(root, "config", "self-host"),
    dataDir: join(root, "data"),
    configPath: join(root, "config", "self-host", "config.toml"),
    secretsPath: join(root, "config", "self-host", "secrets.toml"),
    pgliteDir: join(root, "data", "pglite", "onequery"),
    logsDir: join(root, "data", "logs"),
    serverLogPath: join(root, "data", "logs", "server.log"),
    backupsDir: join(root, "data", "backups"),
    runDir: join(root, "data", "run"),
    pidPath: join(root, "data", "run", "server.pid"),
    lockPath: join(root, "data", "run", "server.lock"),
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
    const root = await mkdtemp(join(tmpdir(), "onequery-bun-lifecycle-"));
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
    const root = await mkdtemp(join(tmpdir(), "onequery-bun-stale-lock-"));
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

  it("stops the Bun server and removes pid and lock files on SIGTERM", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-bun-signal-"));
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      pid: 333,
    });
    const processSignals = new EventEmitter();
    const server = {
      stop: vi.fn(),
    };
    const logWriter = {
      append: vi.fn(async () => {}),
    };

    attachGracefulShutdownHandlers({
      lease,
      logWriter,
      processSignals: processSignals as unknown as NodeJS.Process,
      server,
    });

    processSignals.emit("SIGTERM");

    await waitUntil(async () => {
      expect(server.stop).toHaveBeenCalledWith(true);
      await expect(access(paths.pidPath)).rejects.toBeDefined();
      await expect(access(paths.lockPath)).rejects.toBeDefined();
    });
  });

  it("appends lifecycle log lines into the configured server log file", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-bun-log-"));
    tempRoots.push(root);
    const paths = createPaths(root);

    await appendLifecycleLog(
      paths,
      "[bun-server] listening on http://127.0.0.1:4545",
      () => new Date("2026-03-25T00:00:00.000Z")
    );

    await expect(readFile(paths.serverLogPath, "utf8")).resolves.toContain(
      "2026-03-25T00:00:00.000Z [bun-server] listening on http://127.0.0.1:4545"
    );
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
