import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { create } from "@bufbuild/protobuf";
import { DurationSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  createSelfHostLaunchConfig,
  createSelfHostRuntimePaths,
  createWorkspaceDevLaunchConfig,
} from "@onequery/config/testing";
import type { DatabasePreparationResult } from "@onequery/db/server";
import {
  RuntimePhase,
  RuntimeStatusSchema,
  SupervisorIdentitySchema,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
import {
  SupervisorStopCommandSchema,
  SupervisorControlTargetSchema,
} from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import type { ApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import type {
  ServerStorage,
  ServerStorageHandle,
} from "@onequery/server/storage";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createStartServer } from "./index";
import type { StartServerDependencies } from "./index";
import { loadStartupLaunchConfigResult } from "./startup";

function writeLaunchConfigFile(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "onequery-self-host-index-test-"));
  const launchConfigPath = join(root, "launch.json");

  writeFileSync(launchConfigPath, JSON.stringify(value, null, 2));

  return launchConfigPath;
}

function createTempSelfHostRuntimePaths() {
  const root = mkdtempSync(join(tmpdir(), "onequery-self-host-runtime-test-"));

  // Comment: self-host rate-limit storage is filesystem-backed, so this test
  // must not reuse the shared defaults from @onequery/config/testing.
  return createSelfHostRuntimePaths({
    backupsDir: join(root, "backups"),
    dataDir: join(root, "data"),
    lifecycleEventLogPath: join(root, "run", "lifecycle.events.pb"),
    logsDir: join(root, "logs"),
    runDir: join(root, "run"),
    runtimeLeasePath: join(root, "run", "runtime.lease.json"),
    runtimeStatusSnapshotPath: join(root, "run", "runtime.status.json"),
  });
}

function createTempSupervisorControlEndpoint(
  runtimePaths: ReturnType<typeof createTempSelfHostRuntimePaths>
) {
  return {
    baseUrl: "http://onequery-supervisor",
    maxMessageBytes: 64 * 1024,
    transport: {
      kind: "unix" as const,
      socketPath: join(runtimePaths.runDir, "supervisor-control.sock"),
    },
  };
}

function createMocks() {
  const createApp: StartServerDependencies["createApp"] = vi.fn(() => ({
    fetch: vi.fn(async () => new Response("ok")),
  }));
  const createSpaAssetBindingResult: StartServerDependencies["createSpaAssetBindingResult"] =
    vi.fn(() =>
      Result.ok({
        fetch: vi.fn(async () => new Response("ok")),
      })
    );
  const createServerRuntimeConfig: StartServerDependencies["createServerRuntimeConfig"] =
    vi.fn(
      (launchConfig): ServerRuntimeConfig => ({
        auth: {
          baseURL: launchConfig.publicOrigin,
          emailDelivery: {
            baseURL: launchConfig.publicOrigin,
          },
          secret: launchConfig.auth.secret,
        },
        connectors: {
          enrollmentToken: launchConfig.connectors.enrollmentToken,
        },
        crypto: {
          masterEncryptionKey: new Uint8Array(32),
        },
        listen: launchConfig.listen,
        publicOrigin: launchConfig.publicOrigin,
        rateLimit: {
          api: {
            storage: launchConfig.rateLimit.api.storage,
          },
          enabled: launchConfig.rateLimit.enabled,
        },
        runtimePaths: launchConfig.runtimePaths,
        storage:
          launchConfig.storage.kind === "postgres"
            ? {
                connectionString: launchConfig.storage.url,
                kind: "postgres",
                url: launchConfig.storage.url,
              }
            : {
                connectionString: `pglite:${launchConfig.storage.dir}`,
                dir: launchConfig.storage.dir,
                kind: "pglite",
              },
      })
    );
  const closeServerStorage = vi.fn(async () => undefined);
  const createServerStorageHandle: StartServerDependencies["createServerStorageHandle"] =
    vi.fn(
      (_runtime, apiRateLimitStorage): ServerStorageHandle => ({
        close: closeServerStorage,
        storage: { apiRateLimitStorage } as ServerStorage,
      })
    );
  const prepareRuntimeDatabaseResult: StartServerDependencies["prepareRuntimeDatabaseResult"] =
    vi.fn(async () =>
      Result.ok({
        engine: "postgres",
        mode: "migrate",
      } satisfies DatabasePreparationResult)
    );
  const releaseLifecycleLease = vi.fn(async () => undefined);
  const transitionLifecycleLease = vi.fn(async () => mockRuntimeStatus(2n));
  const persistLifecycleTransition = vi.fn(async () => mockRuntimeStatus(2n));
  const currentLifecycleStatus = vi.fn(() => mockRuntimeStatus(1n));
  const terminalLifecycleStatus = vi.fn(() =>
    mockRuntimeStatus(3n, RuntimePhase.STOPPED)
  );
  const supervisorLifecycleClient = {
    name: "supervisor-lifecycle-client",
  } as unknown as ReturnType<
    StartServerDependencies["createSupervisorLifecycleClient"]
  >;
  const createSupervisorLifecycleClient: StartServerDependencies["createSupervisorLifecycleClient"] =
    vi.fn(() => supervisorLifecycleClient);
  const supervisorRuntimeSessionClose = vi.fn(async () => undefined);
  const supervisorRuntimeSessionReady = vi.fn(async () => undefined);
  const supervisorRuntimeSessionHeartbeat = vi.fn(async () => undefined);
  const openSupervisorRuntimeSession: StartServerDependencies["openSupervisorRuntimeSession"] =
    vi.fn(() => ({
      close: supervisorRuntimeSessionClose,
      closed: new Promise<void>(() => {}),
      heartbeat: supervisorRuntimeSessionHeartbeat,
      opened: Promise.resolve(),
      ready: supervisorRuntimeSessionReady,
    }));
  const acquireRuntimeLifecycleLeaseResult: StartServerDependencies["acquireRuntimeLifecycleLeaseResult"] =
    vi.fn(async (paths) =>
      Result.ok({
        paths,
        currentStatus: currentLifecycleStatus,
        persistTransition: persistLifecycleTransition,
        terminalStatus: terminalLifecycleStatus,
        transition: transitionLifecycleLease,
        release: releaseLifecycleLease,
      })
    );
  const appendLifecycleLog: StartServerDependencies["appendLifecycleLog"] =
    vi.fn(async () => undefined);
  const shutdownController = {
    dispose: vi.fn(),
    shutdown: vi.fn(async () => undefined),
  };
  const attachGracefulShutdownHandlers: StartServerDependencies["attachGracefulShutdownHandlers"] =
    vi.fn(() => shutdownController);
  const serve: StartServerDependencies["serve"] = vi.fn(
    ({ hostname, port }) => ({
      hostname,
      port,
      stop: vi.fn(),
    })
  );

  return {
    acquireRuntimeLifecycleLeaseResult,
    appendLifecycleLog,
    attachGracefulShutdownHandlers,
    createApp,
    closeServerStorage,
    createServerStorageHandle,
    createServerRuntimeConfig,
    createSupervisorLifecycleClient,
    createSpaAssetBindingResult,
    openSupervisorRuntimeSession,
    prepareRuntimeDatabaseResult,
    releaseLifecycleLease,
    currentLifecycleStatus,
    terminalLifecycleStatus,
    persistLifecycleTransition,
    shutdownController,
    supervisorLifecycleClient,
    supervisorRuntimeSessionClose,
    supervisorRuntimeSessionHeartbeat,
    supervisorRuntimeSessionReady,
    transitionLifecycleLease,
    serve,
  };
}

function createDependencies(
  mocks: ReturnType<typeof createMocks>
): StartServerDependencies {
  return {
    acquireRuntimeLifecycleLeaseResult:
      mocks.acquireRuntimeLifecycleLeaseResult,
    appendLifecycleLog: mocks.appendLifecycleLog,
    attachGracefulShutdownHandlers: mocks.attachGracefulShutdownHandlers,
    createApp: mocks.createApp,
    createServerStorageHandle: mocks.createServerStorageHandle,
    createServerRuntimeConfig: mocks.createServerRuntimeConfig,
    createSupervisorLifecycleClient: mocks.createSupervisorLifecycleClient,
    createSpaAssetBindingResult: mocks.createSpaAssetBindingResult,
    loadStartupLaunchConfigResult,
    openSupervisorRuntimeSession: mocks.openSupervisorRuntimeSession,
    prepareRuntimeDatabaseResult: mocks.prepareRuntimeDatabaseResult,
    serve: mocks.serve,
  };
}

describe("startServer", () => {
  let mocks: ReturnType<typeof createMocks>;
  let startServer: ReturnType<typeof createStartServer>;

  beforeEach(() => {
    mocks = createMocks();
    startServer = createStartServer(createDependencies(mocks));
  });

  it("starts from a serialized workspace-dev launch config file", async () => {
    const launchConfigPath = writeLaunchConfigFile(
      createWorkspaceDevLaunchConfig({
        assetsDistDir: "/tmp/web",
        migrationsDir: "/tmp/migrations",
      })
    );

    const server = await startServer({
      launchConfigPath,
    });

    expect(mocks.createServerRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "workspace-dev",
        publicOrigin: "http://localhost:4545",
      })
    );
    expect(mocks.prepareRuntimeDatabaseResult).toHaveBeenCalledWith({
      databaseUrl: "postgres://onequery:onequery@localhost:5454/onequery",
      migrationsDir: "/tmp/migrations",
    });
    expect(mocks.serve).toHaveBeenCalledWith(
      expect.objectContaining({
        fetch: expect.any(Function),
        hostname: "127.0.0.1",
        port: 4555,
      })
    );
    expect(server).toMatchObject({
      hostname: "127.0.0.1",
      port: 4555,
    });
    expect(mocks.acquireRuntimeLifecycleLeaseResult).not.toHaveBeenCalled();
  });

  it("starts from a serialized self-host launch config file", async () => {
    const runtimePaths = createTempSelfHostRuntimePaths();
    const supervisorControl = createTempSupervisorControlEndpoint(runtimePaths);
    const launchConfig = createSelfHostLaunchConfig({
      assetsDistDir: "/tmp/web",
      launchId: "launch-a",
      migrationsDir: "/tmp/migrations",
      runtimePaths,
      supervisorControl,
    });
    const launchConfigPath = writeLaunchConfigFile(launchConfig);

    const server = await startServer({
      launchConfigPath,
    });

    const createServerStorageHandleMock =
      mocks.createServerStorageHandle as typeof mocks.createServerStorageHandle & {
        mock: {
          calls: Array<[ServerRuntimeConfig, ApiRateLimitStorage]>;
        };
      };
    const apiRateLimitStorage = createServerStorageHandleMock.mock.calls.at(
      -1
    )?.[1] as ApiRateLimitStorage;
    expect(apiRateLimitStorage).toBeDefined();
    await expect(apiRateLimitStorage.getItem("user:123")).resolves.toBeNull();
    await apiRateLimitStorage.setItem("user:123", {
      count: 1,
      firstHitAt: 1_742_861_200_000,
    });
    await expect(apiRateLimitStorage.getItem("user:123")).resolves.toEqual({
      count: 1,
      firstHitAt: 1_742_861_200_000,
    });
    expect(mocks.acquireRuntimeLifecycleLeaseResult).toHaveBeenCalledWith(
      {
        controlEndpoint: supervisorControl,
        dataDir: runtimePaths.dataDir,
        lifecycleEventLogPath: runtimePaths.lifecycleEventLogPath,
        logsDir: runtimePaths.logsDir,
        runtimeLeasePath: runtimePaths.runtimeLeasePath,
        runtimeStatusSnapshotPath: runtimePaths.runtimeStatusSnapshotPath,
      },
      expect.objectContaining({
        launchId: "launch-a",
        logWriter: expect.objectContaining({
          append: expect.any(Function),
        }),
        supervisor: expect.objectContaining({
          generation: 7n,
          pid: 1001,
          supervisorId: "gateway-supervisor:1001",
        }),
      })
    );
    expect(mocks.attachGracefulShutdownHandlers).toHaveBeenCalledWith(
      expect.objectContaining({
        lease: expect.objectContaining({
          transition: expect.any(Function),
          release: expect.any(Function),
        }),
        server,
        shutdownResources: expect.arrayContaining([
          expect.objectContaining({
            name: "server-storage",
          }),
        ]),
      })
    );
    expect(mocks.attachGracefulShutdownHandlers).toHaveBeenCalledWith(
      expect.objectContaining({
        shutdownResources: expect.not.arrayContaining([
          expect.objectContaining({
            name: "supervisor-session",
          }),
        ]),
      })
    );
    expect(mocks.createSupervisorLifecycleClient).toHaveBeenCalledWith({
      endpoint: supervisorControl,
    });
    expect(mocks.openSupervisorRuntimeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        client: mocks.supervisorLifecycleClient,
        dataDir: runtimePaths.dataDir,
        launchId: "launch-a",
        runtimePid: process.pid,
        runtimeSequence: 1n,
        onStopCommand: expect.any(Function),
        supervisor: expect.objectContaining({
          generation: 7n,
          pid: 1001,
          supervisorId: "gateway-supervisor:1001",
        }),
      })
    );
    const supervisorSessionInput = vi.mocked(mocks.openSupervisorRuntimeSession)
      .mock.calls[0]?.[0];
    const supervisorIdentity = create(SupervisorIdentitySchema, {
      generation: 7n,
      pid: 1001,
      supervisorId: "gateway-supervisor:1001",
    });
    const graceTimeout = create(DurationSchema, { seconds: 30n });
    const supervisorControlTarget = create(SupervisorControlTargetSchema, {
      dataDir: runtimePaths.dataDir,
      launchId: "launch-a",
      runtimePid: process.pid,
      supervisor: supervisorIdentity,
    });
    await supervisorSessionInput?.onStopCommand?.(
      create(SupervisorStopCommandSchema, {
        completion: 2,
        graceTimeout,
        operationId: "00000000-0000-4000-8000-000000000001",
        reason: "test stop",
        target: supervisorControlTarget,
      })
    );
    expect(mocks.shutdownController.shutdown).toHaveBeenCalledWith({
      completion: "cleanup_and_exit",
      graceTimeout,
      operationId: "00000000-0000-4000-8000-000000000001",
      reason: "test stop",
      target: {
        dataDir: runtimePaths.dataDir,
        launchId: "launch-a",
        pid: process.pid,
        supervisor: supervisorIdentity,
      },
    });
    expect(mocks.supervisorRuntimeSessionClose).not.toHaveBeenCalled();
    expect(mocks.transitionLifecycleLease).toHaveBeenCalledWith(
      RuntimePhase.READY
    );
    expect(mocks.supervisorRuntimeSessionReady).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 2,
        runtimeSequence: 2n,
      })
    );
    expect(mocks.appendLifecycleLog).toHaveBeenCalledWith(
      {
        controlEndpoint: supervisorControl,
        dataDir: runtimePaths.dataDir,
        lifecycleEventLogPath: runtimePaths.lifecycleEventLogPath,
        logsDir: runtimePaths.logsDir,
        runtimeLeasePath: runtimePaths.runtimeLeasePath,
        runtimeStatusSnapshotPath: runtimePaths.runtimeStatusSnapshotPath,
      },
      "[onequery-server] listening on http://127.0.0.1:5656"
    );
    expect(server).toMatchObject({
      hostname: "127.0.0.1",
      port: 5656,
    });
  });

  it("shuts down when the supervisor session closes after ready", async () => {
    const runtimePaths = createTempSelfHostRuntimePaths();
    const launchConfigPath = writeLaunchConfigFile(
      createSelfHostLaunchConfig({
        assetsDistDir: "/tmp/web",
        migrationsDir: "/tmp/migrations",
        runtimePaths,
        supervisorControl: createTempSupervisorControlEndpoint(runtimePaths),
      })
    );
    let resolveClosed: (() => void) | undefined;
    vi.mocked(mocks.openSupervisorRuntimeSession).mockReturnValueOnce({
      close: mocks.supervisorRuntimeSessionClose,
      closed: new Promise<void>((resolve) => {
        resolveClosed = resolve;
      }),
      heartbeat: mocks.supervisorRuntimeSessionHeartbeat,
      opened: Promise.resolve(),
      ready: mocks.supervisorRuntimeSessionReady,
    });

    await startServer({ launchConfigPath });
    expect(mocks.supervisorRuntimeSessionReady).toHaveBeenCalledTimes(1);
    expect(mocks.shutdownController.shutdown).not.toHaveBeenCalled();

    resolveClosed?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.shutdownController.shutdown).toHaveBeenCalledWith({
      completion: "cleanup_and_exit",
      reason: "supervisor_session_closed",
    });
  });

  it("disposes graceful shutdown handlers when startup cleanup runs after handler attachment", async () => {
    const runtimePaths = createTempSelfHostRuntimePaths();
    const launchConfigPath = writeLaunchConfigFile(
      createSelfHostLaunchConfig({
        assetsDistDir: "/tmp/web",
        migrationsDir: "/tmp/migrations",
        runtimePaths,
        supervisorControl: createTempSupervisorControlEndpoint(runtimePaths),
      })
    );
    mocks.transitionLifecycleLease.mockRejectedValueOnce(
      new Error("ready transition failed")
    );

    await expect(
      startServer({
        launchConfigPath,
      })
    ).rejects.toMatchObject({
      _tag: "StartServerWorkflowError",
      step: "transition_lifecycle_ready",
    });

    expect(mocks.shutdownController.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.supervisorRuntimeSessionClose).toHaveBeenCalledTimes(1);
    expect(mocks.closeServerStorage).toHaveBeenCalledTimes(1);
    expect(mocks.releaseLifecycleLease).toHaveBeenCalledWith({
      reason: "startup_failure",
      stopServer: false,
    });
  });
});

function mockRuntimeStatus(
  runtimeSequence: bigint,
  phase = RuntimePhase.READY
) {
  return create(RuntimeStatusSchema, {
    identity: {
      dataDir: "/tmp/onequery-data",
      launchId: "launch-a",
      pid: process.pid,
    },
    phase,
    runtimeSequence,
    updatedAt: timestampFromDate(new Date("2026-04-29T00:00:00.000Z")),
  });
}
