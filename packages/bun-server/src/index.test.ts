import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "@onequery/config/testing";
import type { DatabasePreparationResult } from "@onequery/db/server";
import type { RuntimeRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RUNTIME_RATE_LIMIT_STORAGE_DIRNAME } from "./constants";
import { createStartBunServer } from "./index";
import type { StartBunServerDependencies } from "./index";
import { loadStartupLaunchConfig } from "./startup";

function writeLaunchConfigFile(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "onequery-bun-index-test-"));
  const launchConfigPath = join(root, "launch.json");

  writeFileSync(launchConfigPath, JSON.stringify(value, null, 2));

  return launchConfigPath;
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
      (launchConfig, services): ServerRuntimeConfig => ({
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
          masterEncryptionKey: launchConfig.crypto.masterEncryptionKey,
        },
        listen: launchConfig.listen,
        mode: launchConfig.mode,
        publicOrigin: launchConfig.publicOrigin,
        rateLimit: {
          enabled: launchConfig.rateLimit.enabled,
          runtimeStorage: services.rateLimitStorage,
          storage: launchConfig.rateLimit.storage,
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
  const prepareRuntimeDatabase: StartBunServerDependencies["prepareRuntimeDatabase"] =
    vi.fn(
      async (): Promise<DatabasePreparationResult> => ({
        engine: "postgres",
        mode: "migrate",
      })
    );
  const createPersistentRuntimeRateLimitStorage: StartBunServerDependencies["createPersistentRuntimeRateLimitStorage"] =
    vi.fn(
      (dir: string): RuntimeRateLimitStorage => ({
        api: createStorage({
          driver: memoryDriver(),
        }),
        auth: {
          async get(key) {
            return key === dir
              ? {
                  count: 1,
                  key,
                  lastRequest: 0,
                }
              : undefined;
          },
          async set() {},
        },
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
    createPersistentRuntimeRateLimitStorage,
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
    createPersistentRuntimeRateLimitStorage:
      mocks.createPersistentRuntimeRateLimitStorage,
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
    const launchConfigPath = writeLaunchConfigFile({
      assets: {
        distDir: "/tmp/web",
      },
      auth: {
        secret: "workspace-auth-secret",
      },
      connectors: {
        enrollmentToken: "connector-token",
      },
      crypto: {
        masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
      },
      listen: {
        host: "127.0.0.1",
        port: 4555,
      },
      migrations: {
        dir: "/tmp/migrations",
      },
      mode: "workspace-dev",
      publicOrigin: "http://localhost:4545",
      rateLimit: {
        enabled: false,
        storage: "memory",
      },
      storage: {
        kind: "postgres",
        url: "postgres://onequery:onequery@localhost:5454/onequery",
      },
    });

    const server = await startBunServer({
      launchConfigPath,
    });

    expect(mocks.createServerRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "workspace-dev",
        publicOrigin: "http://localhost:4545",
      }),
      {
        rateLimitStorage: undefined,
      }
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
    const runtimePaths = {
      backupsDir: "/tmp/onequery/backups",
      dataDir: "/tmp/onequery/data",
      lockPath: "/tmp/onequery/run/server.lock",
      logsDir: "/tmp/onequery/logs",
      pidPath: "/tmp/onequery/run/server.pid",
      runDir: "/tmp/onequery/run",
    };
    const launchConfigPath = writeLaunchConfigFile({
      assets: {
        distDir: "/tmp/web",
      },
      auth: {
        secret: "self-host-auth-secret",
      },
      connectors: {
        enrollmentToken: "connector-token",
      },
      crypto: {
        masterEncryptionKey: SAMPLE_MASTER_ENCRYPTION_KEY,
      },
      listen: {
        host: "127.0.0.1",
        port: 5656,
      },
      migrations: {
        dir: "/tmp/migrations",
      },
      mode: "self-host",
      publicOrigin: "http://127.0.0.1:5656",
      rateLimit: {
        enabled: true,
        storage: "persistent",
      },
      runtimePaths,
      storage: {
        dir: "/tmp/onequery/pglite",
        kind: "pglite",
      },
    });

    const server = await startBunServer({
      launchConfigPath,
    });

    expect(mocks.createPersistentRuntimeRateLimitStorage).toHaveBeenCalledWith(
      join("/tmp/onequery/data", RUNTIME_RATE_LIMIT_STORAGE_DIRNAME)
    );
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
