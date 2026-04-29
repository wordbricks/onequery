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

import { create } from "@bufbuild/protobuf";
import { viewServerLaunchConfig } from "@onequery/config/server-launch";
import {
  createSelfHostLaunchConfig,
  createSelfHostRuntimePaths,
  createSelfHostSupervisorControl,
  createWorkspaceDevLaunchConfig,
} from "@onequery/config/testing";
import {
  RuntimePhase,
  SupervisorIdentitySchema,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import type { SupervisorIdentity } from "@onequery/proto-runtime/runtime/v1/common_pb";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DuplicateRuntimeStartError,
  RuntimeLifecycleOptionsError,
  RuntimeShutdownError,
  acquireRuntimeLifecycleLease,
  acquireRuntimeLifecycleLeaseResult,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
  toLifecyclePaths,
} from "./lifecycle";
import type { SelfHostLifecyclePaths } from "./lifecycle";

function createPaths(root: string): SelfHostLifecyclePaths & {
  leasePath: string;
  runDir: string;
  serverLogPath: string;
  statusPath: string;
} {
  const dataDir = join(root, "data");
  const logsDir = join(dataDir, "logs");
  const runDir = join(dataDir, "run");

  return {
    controlEndpoint: createSelfHostSupervisorControl({
      socketPath: join(runDir, "supervisor-control.sock"),
    }),
    dataDir,
    lifecycleEventLogPath: join(runDir, "lifecycle.events.pb"),
    logsDir,
    runtimeLeasePath: join(runDir, "runtime.lease.json"),
    runtimeStatusSnapshotPath: join(runDir, "runtime.status.json"),
    leasePath: join(runDir, "runtime.lease.json"),
    runDir,
    serverLogPath: join(logsDir, "server.log"),
    statusPath: join(runDir, "runtime.status.json"),
  };
}

function createTestSupervisorIdentity(
  input: {
    generation?: bigint;
    pid?: number;
    supervisorId?: string;
  } = {}
): SupervisorIdentity {
  const pid = input.pid ?? 1001;

  return create(SupervisorIdentitySchema, {
    generation: input.generation ?? 7n,
    pid,
    supervisorId: input.supervisorId ?? `gateway-supervisor:${pid}`,
  });
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

  it("blocks a duplicate start for the same data directory while the lease holder is alive", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-self-host-lifecycle-"));
    tempRoots.push(root);
    const paths = createPaths(root);
    const logWriter = {
      append: vi.fn(async () => {}),
    };

    const firstLease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: (pid) => pid === 111,
      launchId: "launch-a",
      logWriter,
      pid: 111,
      supervisor: createTestSupervisorIdentity(),
    });

    await expect(
      acquireRuntimeLifecycleLease(paths, {
        isProcessRunning: (pid) => pid === 111,
        launchId: "launch-b",
        logWriter,
        pid: 222,
        supervisor: createTestSupervisorIdentity({
          generation: 8n,
          pid: 1002,
        }),
      })
    ).rejects.toBeInstanceOf(DuplicateRuntimeStartError);

    await firstLease.release({
      reason: "test_cleanup",
      stopServer: false,
    });
  });

  it("replaces a stale runtime lease before acquiring a new lifecycle lease", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-stale-lease-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);

    await mkdir(paths.runDir, {
      recursive: true,
    });
    await writeFile(paths.leasePath, "{}\n");

    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 222,
      supervisor: createTestSupervisorIdentity(),
    });
    const leaseContents = await readFile(paths.leasePath, "utf8");

    expect(leaseContents).toContain('"pid":222');

    await lease.release({
      reason: "test_cleanup",
      stopServer: false,
    });
  });

  it("replaces an expired runtime lease even when the old pid is alive", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-expired-lease-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const oldLeaseTime = new Date("2026-04-29T00:00:00.000Z");
    const newLeaseTime = new Date("2026-04-29T00:02:01.000Z");

    await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: (pid) => pid === 111,
      launchId: "launch-a",
      now: () => oldLeaseTime,
      pid: 111,
      supervisor: createTestSupervisorIdentity(),
    });

    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: (pid) => pid === 111,
      launchId: "launch-b",
      now: () => newLeaseTime,
      pid: 222,
      supervisor: createTestSupervisorIdentity({
        generation: 8n,
        pid: 1002,
      }),
    });
    const leaseContents = await readFile(paths.leasePath, "utf8");

    expect(leaseContents).toContain('"pid":222');

    await lease.release({
      reason: "test_cleanup",
      stopServer: false,
    });
  });

  it("rejects an empty launch id before creating lifecycle files", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-empty-launch-id-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);

    const result = await acquireRuntimeLifecycleLeaseResult(paths, {
      launchId: " ",
      pid: 222,
      supervisor: createTestSupervisorIdentity(),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(RuntimeLifecycleOptionsError);
    }
    await expect(access(paths.runDir)).rejects.toBeDefined();
  });

  it("rejects lifecycle acquisition without an explicit supervisor identity", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-missing-supervisor-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);

    const result = await acquireRuntimeLifecycleLeaseResult(paths, {
      launchId: "launch-a",
      pid: 222,
    } as unknown as Parameters<typeof acquireRuntimeLifecycleLeaseResult>[1]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(RuntimeLifecycleOptionsError);
      expect(result.error.message).toBe(
        "runtime lifecycle supervisor identity is required"
      );
    }
    await expect(access(paths.runDir)).rejects.toBeDefined();
  });

  it("records startup and shutdown lifecycle phases in the runtime status snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-self-host-state-"));
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      now: () => new Date("2026-03-25T00:00:00.000Z"),
      pid: 333,
      supervisor: createTestSupervisorIdentity(),
    });

    await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
      '"phase":"RUNTIME_PHASE_STARTING"'
    );
    await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
      '"launchId":"launch-a"'
    );

    await lease.transition(RuntimePhase.READY);

    await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
      '"phase":"RUNTIME_PHASE_READY"'
    );

    await lease.release({
      reason: "test_cleanup",
      stopServer: false,
    });

    await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
      '"phase":"RUNTIME_PHASE_READY"'
    );
    await expect(access(paths.leasePath)).rejects.toBeDefined();
  });

  it("serializes concurrent lifecycle transitions against the active lease state", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-concurrent-transition-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 334,
      supervisor: createTestSupervisorIdentity(),
    });

    await Promise.all([
      lease.transition(RuntimePhase.READY),
      lease.transition(RuntimePhase.STOPPING),
    ]);

    const statusSnapshot = JSON.parse(await readFile(paths.statusPath, "utf8"));
    expect(statusSnapshot.status.phase).toBe("RUNTIME_PHASE_STOPPING");
    expect(statusSnapshot.status.runtimeSequence).toBe("3");

    await lease.release({
      reason: "test_cleanup",
      stopServer: false,
    });
  });

  it("stops the packaged server runtime and releases the lifecycle lease on SIGTERM", async () => {
    const root = await mkdtemp(join(tmpdir(), "onequery-self-host-signal-"));
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 333,
      supervisor: createTestSupervisorIdentity(),
    });
    const processSignals = new EventEmitter();
    let resolveServerStop = () => {};
    const serverStopPromise = new Promise<void>((resolve) => {
      resolveServerStop = resolve;
    });
    let resolveStorageClose = () => {};
    const storageClosePromise = new Promise<void>((resolve) => {
      resolveStorageClose = resolve;
    });
    const events: string[] = [];
    const server = {
      stop: vi.fn(async () => {
        events.push("stop:start");
        await serverStopPromise;
        events.push("stop:done");
      }),
    };
    const storageResource = {
      close: vi.fn(async () => {
        events.push("storage:start");
        await storageClosePromise;
        events.push("storage:done");
      }),
      name: "server-storage",
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
      shutdownResources: [storageResource],
    });

    processSignals.emit("SIGTERM");
    processSignals.emit("SIGINT");

    await waitUntil(async () => {
      expect(server.stop).toHaveBeenCalledWith(true);
    });
    expect(exitProcess).not.toHaveBeenCalled();
    await access(paths.statusPath);
    await access(paths.leasePath);
    await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
      '"phase":"RUNTIME_PHASE_DRAINING"'
    );

    resolveServerStop();

    await waitUntil(async () => {
      expect(storageResource.close).toHaveBeenCalledTimes(1);
      expect(exitProcess).not.toHaveBeenCalled();
      await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
        '"phase":"RUNTIME_PHASE_CHECKPOINTING"'
      );
    });

    resolveStorageClose();

    await waitUntil(async () => {
      expect(exitProcess).toHaveBeenCalledWith(0);
      await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
        '"phase":"RUNTIME_PHASE_CHECKPOINTING"'
      );
      await expect(access(paths.leasePath)).rejects.toBeDefined();
      expect(events).toEqual([
        "stop:start",
        "stop:done",
        "storage:start",
        "storage:done",
        "exit:0",
      ]);
    });
  });

  it("keeps the lifecycle lease and exits with failure when server shutdown errors", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-signal-failure-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 444,
      supervisor: createTestSupervisorIdentity(),
    });
    const processSignals = new EventEmitter();
    const stopError = new Error("server close failed");
    const server = {
      stop: vi.fn(async () => {
        throw stopError;
      }),
    };
    const storageResource = {
      close: vi.fn(async () => {}),
      name: "server-storage",
    };
    const exitProcess = vi.fn();

    attachGracefulShutdownHandlers({
      exitProcess,
      lease,
      processSignals,
      server,
      shutdownResources: [storageResource],
    });

    processSignals.emit("SIGTERM");

    await waitUntil(async () => {
      expect(server.stop).toHaveBeenCalledWith(true);
      expect(storageResource.close).toHaveBeenCalledTimes(1);
      expect(exitProcess).toHaveBeenCalledWith(1);
      await access(paths.statusPath);
      await access(paths.leasePath);
      await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
        '"phase":"RUNTIME_PHASE_SHUTDOWN_FAILED"'
      );
      await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
        '"code":"RUNTIME_FAILURE_CODE_SHUTDOWN_REJECTED"'
      );
    });
  });

  it("keeps the lifecycle lease and exits with failure when storage checkpoint errors", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-storage-failure-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 445,
      supervisor: createTestSupervisorIdentity(),
    });
    const processSignals = new EventEmitter();
    const storageError = new Error("storage close failed");
    const server = {
      stop: vi.fn(async () => {}),
    };
    const storageResource = {
      close: vi.fn(async () => {
        throw storageError;
      }),
      failureCode: "checkpoint_failed" as const,
      name: "server-storage",
    };
    const exitProcess = vi.fn();

    attachGracefulShutdownHandlers({
      exitProcess,
      lease,
      processSignals,
      server,
      shutdownResources: [storageResource],
    });

    processSignals.emit("SIGTERM");

    await waitUntil(async () => {
      expect(server.stop).toHaveBeenCalledWith(true);
      expect(storageResource.close).toHaveBeenCalledTimes(1);
      expect(exitProcess).toHaveBeenCalledWith(1);
      await access(paths.statusPath);
      await access(paths.leasePath);
      await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
        '"phase":"RUNTIME_PHASE_SHUTDOWN_FAILED"'
      );
      await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
        '"code":"RUNTIME_FAILURE_CODE_CHECKPOINT_FAILED"'
      );
    });
  });

  it("records generic resource close failures in the lifecycle snapshot", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-resource-failure-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 446,
      supervisor: createTestSupervisorIdentity(),
    });
    const processSignals = new EventEmitter();
    const resourceError = new Error("supervisor control close failed");
    const server = {
      stop: vi.fn(async () => {}),
    };
    const supervisorControlResource = {
      close: vi.fn(async () => {
        throw resourceError;
      }),
      name: "supervisor-control",
    };
    const exitProcess = vi.fn();

    attachGracefulShutdownHandlers({
      exitProcess,
      lease,
      processSignals,
      server,
      shutdownResources: [supervisorControlResource],
    });

    processSignals.emit("SIGTERM");

    await waitUntil(async () => {
      expect(server.stop).toHaveBeenCalledWith(true);
      expect(supervisorControlResource.close).toHaveBeenCalledTimes(1);
      expect(exitProcess).toHaveBeenCalledWith(1);
      await access(paths.statusPath);
      await access(paths.leasePath);
      await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
        '"phase":"RUNTIME_PHASE_SHUTDOWN_FAILED"'
      );
      await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
        '"code":"RUNTIME_FAILURE_CODE_RESOURCE_CLOSE_FAILED"'
      );
    });
  });

  it("fails shutdown locally when grace timeout expires during resource close", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-shutdown-timeout-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 447,
      supervisor: createTestSupervisorIdentity(),
    });
    const processSignals = new EventEmitter();
    const server = {
      stop: vi.fn(async () => {}),
    };
    const storageResource = {
      close: vi.fn(() => new Promise<void>(() => undefined)),
      name: "server-storage",
    };
    const exitProcess = vi.fn();
    const controller = attachGracefulShutdownHandlers({
      exitProcess,
      lease,
      processSignals,
      server,
      shutdownResources: [storageResource],
    });

    const shutdown = controller.shutdown({
      completion: "cleanup_only",
      graceTimeout: {
        nanos: 250_000_000,
        seconds: 0n,
      },
      reason: "manual",
    });

    await expect(shutdown).rejects.toMatchObject({
      failure: {
        code: "shutdown_timeout",
      },
    });
    expect(server.stop).toHaveBeenCalledWith(true);
    expect(storageResource.close).toHaveBeenCalledTimes(1);
    expect(exitProcess).not.toHaveBeenCalled();
    await access(paths.statusPath);
    await access(paths.leasePath);
    await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
      '"phase":"RUNTIME_PHASE_SHUTDOWN_FAILED"'
    );
    await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
      '"code":"RUNTIME_FAILURE_CODE_SHUTDOWN_TIMEOUT"'
    );
  });

  it("disposes shutdown coordination without handling later process signals", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-disposed-controller-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 446,
      supervisor: createTestSupervisorIdentity(),
    });
    const processSignals = new EventEmitter();
    const server = {
      stop: vi.fn(async () => {}),
    };
    const controller = attachGracefulShutdownHandlers({
      lease,
      processSignals,
      server,
    });

    controller.dispose();
    processSignals.emit("SIGTERM");

    await expect(
      controller.shutdown({
        completion: "cleanup_only",
        reason: "manual",
      })
    ).rejects.toBeInstanceOf(RuntimeShutdownError);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.stop).not.toHaveBeenCalled();

    await lease.release({
      reason: "test_cleanup",
      stopServer: false,
    });
  });

  it("allows an in-flight manual shutdown to finish after controller disposal", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-dispose-in-flight-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);
    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 447,
      supervisor: createTestSupervisorIdentity(),
    });
    const processSignals = new EventEmitter();
    let resolveServerStop = () => {};
    const serverStopPromise = new Promise<void>((resolve) => {
      resolveServerStop = resolve;
    });
    const server = {
      stop: vi.fn(async () => {
        await serverStopPromise;
      }),
    };
    const storageResource = {
      close: vi.fn(async () => {}),
      name: "server-storage",
    };
    const exitProcess = vi.fn();
    const controller = attachGracefulShutdownHandlers({
      exitProcess,
      lease,
      processSignals,
      server,
      shutdownResources: [storageResource],
    });

    const shutdown = controller.shutdown({
      completion: "cleanup_only",
      reason: "manual",
    });
    await waitUntil(async () => {
      expect(server.stop).toHaveBeenCalledWith(true);
    });

    controller.dispose();
    resolveServerStop();

    await expect(shutdown).resolves.toBeUndefined();
    expect(storageResource.close).toHaveBeenCalledTimes(1);
    expect(exitProcess).not.toHaveBeenCalled();
    await expect(readFile(paths.statusPath, "utf8")).resolves.toContain(
      '"phase":"RUNTIME_PHASE_CHECKPOINTING"'
    );
    await expect(access(paths.leasePath)).rejects.toBeDefined();
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
    const result = toLifecyclePaths(
      viewServerLaunchConfig(createWorkspaceDevLaunchConfig(), "test")
    );

    expect(result).toEqual({
      kind: "unmanaged",
    });
  });

  it("returns a self-host lifecycle-path resolution when runtime paths are present", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-path-resolution-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);

    const result = toLifecyclePaths(
      viewServerLaunchConfig(
        createSelfHostLaunchConfig({
          runtimePaths: createSelfHostRuntimePaths({
            backupsDir: join(root, "backups"),
            dataDir: paths.dataDir,
            lifecycleEventLogPath: paths.lifecycleEventLogPath,
            logsDir: paths.logsDir,
            runDir: paths.runDir,
            runtimeLeasePath: paths.leasePath,
            runtimeStatusSnapshotPath: paths.statusPath,
          }),
          supervisorControl: paths.controlEndpoint,
        }),
        "test"
      )
    );

    expect(result).toEqual({
      kind: "self-host",
      paths: {
        controlEndpoint: paths.controlEndpoint,
        dataDir: paths.dataDir,
        lifecycleEventLogPath: paths.lifecycleEventLogPath,
        logsDir: paths.logsDir,
        runtimeLeasePath: paths.leasePath,
        runtimeStatusSnapshotPath: paths.statusPath,
      },
    });
  });

  it("replaces an invalid lease record before acquiring a new lifecycle lease", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "onequery-self-host-invalid-lease-")
    );
    tempRoots.push(root);
    const paths = createPaths(root);

    await mkdir(paths.runDir, {
      recursive: true,
    });
    await writeFile(paths.leasePath, "{not-json");

    const lease = await acquireRuntimeLifecycleLease(paths, {
      isProcessRunning: () => false,
      launchId: "launch-a",
      pid: 555,
      supervisor: createTestSupervisorIdentity(),
    });

    await expect(readFile(paths.leasePath, "utf8")).resolves.toContain(
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
