import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSelfHostLaunchConfig,
  createSelfHostRuntimePaths,
  createWorkspaceDevLaunchConfig,
} from "@onequery/config/testing";
import type { DatabasePreparationResult } from "@onequery/db/server";
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
    lockPath: join(root, "run", "server.lock"),
    logsDir: join(root, "logs"),
    pidPath: join(root, "run", "server.pid"),
    runDir: join(root, "run"),
  });
}

function createTempRuntimeControlEndpoint(
  runtimePaths: ReturnType<typeof createTempSelfHostRuntimePaths>
) {
  return {
    socketPath: join(runtimePaths.runDir, "runtime-control.sock"),
    transport: "unix" as const,
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
        mode: launchConfig.mode,
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
  const transitionLifecycleLease = vi.fn(async () => undefined);
  const attachRuntimeControlShutdownController = vi.fn();
  const disposeRuntimeControlActor = vi.fn();
  const runtimeControlServerClose = vi.fn(async () => undefined);
  const acquireRuntimeLifecycleLeaseResult: StartServerDependencies["acquireRuntimeLifecycleLeaseResult"] =
    vi.fn(async (paths) =>
      Result.ok({
        paths,
        transition: transitionLifecycleLease,
        release: releaseLifecycleLease,
      })
    );
  const createRuntimeControlActor: StartServerDependencies["createRuntimeControlActor"] =
    vi.fn(({ lease }) => ({
      attachShutdownController: attachRuntimeControlShutdownController,
      dispose: disposeRuntimeControlActor,
      getStatus: vi.fn(async () => ({
        identity: {
          dataDir: lease.paths.dataDir,
          launchId: "launch-a",
          pid: process.pid,
        },
        phase: 2,
        sequence: 1n,
      })),
      lease,
      stop: vi.fn(async () => ({
        disposition: 1,
        status: {
          identity: {
            dataDir: lease.paths.dataDir,
            launchId: "launch-a",
            pid: process.pid,
          },
          phase: 5,
          sequence: 2n,
        },
      })),
      watchStatus: vi.fn(async function* watchStatus() {}),
    }));
  const serveRuntimeControl: StartServerDependencies["serveRuntimeControl"] =
    vi.fn(async ({ endpoint }) => ({
      close: runtimeControlServerClose,
      name: "runtime-control" as const,
      socketPath: endpoint.socketPath,
    }));
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
    attachRuntimeControlShutdownController,
    createApp,
    closeServerStorage,
    createServerStorageHandle,
    createServerRuntimeConfig,
    createRuntimeControlActor,
    createSpaAssetBindingResult,
    disposeRuntimeControlActor,
    prepareRuntimeDatabaseResult,
    releaseLifecycleLease,
    runtimeControlServerClose,
    shutdownController,
    transitionLifecycleLease,
    serveRuntimeControl,
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
    createRuntimeControlActor: mocks.createRuntimeControlActor,
    createSpaAssetBindingResult: mocks.createSpaAssetBindingResult,
    loadStartupLaunchConfigResult,
    prepareRuntimeDatabaseResult: mocks.prepareRuntimeDatabaseResult,
    serveRuntimeControl: mocks.serveRuntimeControl,
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
    const runtimeControl = createTempRuntimeControlEndpoint(runtimePaths);
    const launchConfig = createSelfHostLaunchConfig({
      assetsDistDir: "/tmp/web",
      launchId: "launch-a",
      migrationsDir: "/tmp/migrations",
      runtimeControl,
      runtimePaths,
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
        controlEndpoint: runtimeControl,
        dataDir: runtimePaths.dataDir,
        lockPath: runtimePaths.lockPath,
        logsDir: runtimePaths.logsDir,
        pidPath: runtimePaths.pidPath,
      },
      expect.objectContaining({
        launchId: "launch-a",
        logWriter: expect.objectContaining({
          append: expect.any(Function),
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
            name: "runtime-control",
          }),
          expect.objectContaining({
            name: "server-storage",
          }),
        ]),
      })
    );
    expect(mocks.createRuntimeControlActor).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: {
          dataDir: runtimePaths.dataDir,
          launchId: "launch-a",
          pid: process.pid,
        },
      })
    );
    expect(mocks.attachRuntimeControlShutdownController).toHaveBeenCalledWith(
      mocks.shutdownController
    );
    expect(mocks.serveRuntimeControl).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: runtimeControl,
      })
    );
    expect(mocks.transitionLifecycleLease).toHaveBeenCalledWith("ready");
    expect(mocks.appendLifecycleLog).toHaveBeenCalledWith(
      {
        controlEndpoint: runtimeControl,
        dataDir: runtimePaths.dataDir,
        lockPath: runtimePaths.lockPath,
        logsDir: runtimePaths.logsDir,
        pidPath: runtimePaths.pidPath,
      },
      "[onequery-server] listening on http://127.0.0.1:5656"
    );
    expect(server).toMatchObject({
      hostname: "127.0.0.1",
      port: 5656,
    });
  });

  it("disposes graceful shutdown handlers when startup cleanup runs after handler attachment", async () => {
    const runtimePaths = createTempSelfHostRuntimePaths();
    const launchConfigPath = writeLaunchConfigFile(
      createSelfHostLaunchConfig({
        assetsDistDir: "/tmp/web",
        migrationsDir: "/tmp/migrations",
        runtimeControl: createTempRuntimeControlEndpoint(runtimePaths),
        runtimePaths,
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
    expect(mocks.runtimeControlServerClose).toHaveBeenCalledTimes(1);
    expect(mocks.closeServerStorage).toHaveBeenCalledTimes(1);
    expect(mocks.releaseLifecycleLease).toHaveBeenCalledWith({
      reason: "startup_failure",
      stopServer: false,
    });
  });
});
