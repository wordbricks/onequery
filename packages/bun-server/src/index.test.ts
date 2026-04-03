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
import type { ServerStorage } from "@onequery/server/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createStartBunServer } from "./index";
import type { StartBunServerDependencies } from "./index";
import { loadStartupLaunchConfig } from "./startup";

function writeLaunchConfigFile(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "onequery-bun-index-test-"));
  const launchConfigPath = join(root, "launch.json");

  writeFileSync(launchConfigPath, JSON.stringify(value, null, 2));

  return launchConfigPath;
}

function createTempSelfHostRuntimePaths() {
  const root = mkdtempSync(join(tmpdir(), "onequery-bun-runtime-test-"));

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

function createMocks() {
  const createApp: StartBunServerDependencies["createApp"] = vi.fn(() => ({
    fetch: vi.fn(async () => new Response("ok")),
  }));
  const createSpaAssetBinding: StartBunServerDependencies["createSpaAssetBinding"] =
    vi.fn(() => ({
      fetch: vi.fn(async () => new Response("ok")),
    }));
  const createServerRuntimeConfig: StartBunServerDependencies["createServerRuntimeConfig"] =
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
  const createServerStorage: StartBunServerDependencies["createServerStorage"] =
    vi.fn(
      (_runtime, apiRateLimitStorage): ServerStorage =>
        ({ apiRateLimitStorage }) as ServerStorage
    );
  const prepareRuntimeDatabase: StartBunServerDependencies["prepareRuntimeDatabase"] =
    vi.fn(
      async (): Promise<DatabasePreparationResult> => ({
        engine: "postgres",
        mode: "migrate",
      })
    );
  const releaseLifecycleLease = vi.fn(async () => undefined);
  const acquireRuntimeLifecycleLease: StartBunServerDependencies["acquireRuntimeLifecycleLease"] =
    vi.fn(async () => ({
      paths: {
        dataDir: "/tmp/onequery/data",
        lockPath: "/tmp/onequery/run/server.lock",
        logsDir: "/tmp/onequery/logs",
        pidPath: "/tmp/onequery/run/server.pid",
      },
      release: releaseLifecycleLease,
    }));
  const appendLifecycleLog: StartBunServerDependencies["appendLifecycleLog"] =
    vi.fn(async () => undefined);
  const attachGracefulShutdownHandlers = vi.fn();
  const toLifecyclePaths: StartBunServerDependencies["toLifecyclePaths"] =
    vi.fn((launchConfig) => launchConfig.runtimePaths);
  const serve: StartBunServerDependencies["serve"] = vi.fn(
    ({ hostname, port }) => ({
      hostname,
      port,
      stop: vi.fn(),
    })
  );

  return {
    acquireRuntimeLifecycleLease,
    appendLifecycleLog,
    attachGracefulShutdownHandlers,
    createApp,
    createServerStorage,
    createServerRuntimeConfig,
    createSpaAssetBinding,
    prepareRuntimeDatabase,
    releaseLifecycleLease,
    serve,
    toLifecyclePaths,
  };
}

function createDependencies(
  mocks: ReturnType<typeof createMocks>
): StartBunServerDependencies {
  return {
    acquireRuntimeLifecycleLease: mocks.acquireRuntimeLifecycleLease,
    appendLifecycleLog: mocks.appendLifecycleLog,
    attachGracefulShutdownHandlers: mocks.attachGracefulShutdownHandlers,
    createApp: mocks.createApp,
    createServerStorage: mocks.createServerStorage,
    createServerRuntimeConfig: mocks.createServerRuntimeConfig,
    createSpaAssetBinding: mocks.createSpaAssetBinding,
    loadStartupLaunchConfig,
    prepareRuntimeDatabase: mocks.prepareRuntimeDatabase,
    serve: mocks.serve,
    toLifecyclePaths: mocks.toLifecyclePaths,
  };
}

describe("startBunServer", () => {
  let mocks: ReturnType<typeof createMocks>;
  let startBunServer: ReturnType<typeof createStartBunServer>;

  beforeEach(() => {
    mocks = createMocks();
    startBunServer = createStartBunServer(createDependencies(mocks));
  });

  it("starts from a serialized workspace-dev launch config file", async () => {
    const launchConfigPath = writeLaunchConfigFile(
      createWorkspaceDevLaunchConfig({
        assetsDistDir: "/tmp/web",
        migrationsDir: "/tmp/migrations",
      })
    );

    const server = await startBunServer({
      launchConfigPath,
    });

    expect(mocks.createServerRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "workspace-dev",
        publicOrigin: "http://localhost:4545",
      })
    );
    expect(mocks.prepareRuntimeDatabase).toHaveBeenCalledWith({
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
    expect(mocks.acquireRuntimeLifecycleLease).not.toHaveBeenCalled();
  });

  it("starts from a serialized self-host launch config file", async () => {
    const runtimePaths = createTempSelfHostRuntimePaths();
    const launchConfigPath = writeLaunchConfigFile(
      createSelfHostLaunchConfig({
        assetsDistDir: "/tmp/web",
        migrationsDir: "/tmp/migrations",
        runtimePaths,
      })
    );

    const server = await startBunServer({
      launchConfigPath,
    });

    const createServerStorageMock =
      mocks.createServerStorage as typeof mocks.createServerStorage & {
        mock: {
          calls: Array<[ServerRuntimeConfig, ApiRateLimitStorage]>;
        };
      };
    const apiRateLimitStorage = createServerStorageMock.mock.calls.at(
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
    expect(mocks.acquireRuntimeLifecycleLease).toHaveBeenCalledWith(
      runtimePaths,
      expect.objectContaining({
        logWriter: expect.objectContaining({
          append: expect.any(Function),
        }),
      })
    );
    expect(mocks.attachGracefulShutdownHandlers).toHaveBeenCalledWith(
      expect.objectContaining({
        lease: expect.objectContaining({
          release: expect.any(Function),
        }),
        server,
      })
    );
    expect(mocks.appendLifecycleLog).toHaveBeenCalledWith(
      runtimePaths,
      "[bun-server] listening on http://127.0.0.1:5656"
    );
    expect(server).toMatchObject({
      hostname: "127.0.0.1",
      port: 5656,
    });
  });
});
