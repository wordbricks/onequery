import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_MASTER_ENCRYPTION_KEY } from "../../config/src/testing";
import { RUNTIME_RATE_LIMIT_STORAGE_DIRNAME } from "./constants";

const mocks = vi.hoisted(() => {
  const createApp = vi.fn(() => ({
    fetch: vi.fn(async () => new Response("ok")),
  }));
  const createSpaAssetBinding = vi.fn(() => ({
    fetch: vi.fn(async () => new Response("ok")),
  }));
  const createServerRuntimeConfig = vi.fn((launchConfig, services) => ({
    publicOrigin: launchConfig.publicOrigin,
    rateLimitStorage: services.rateLimitStorage,
    storage: {
      connectionString:
        launchConfig.storage.kind === "postgres"
          ? launchConfig.storage.url
          : `pglite:${launchConfig.storage.dir}`,
    },
  }));
  const prepareRuntimeDatabase = vi.fn(async () => undefined);
  const createPersistentRuntimeRateLimitStorage = vi.fn((dir: string) => ({
    dir,
    kind: "persistent-rate-limit-storage",
  }));
  const releaseLifecycleLease = vi.fn(async () => undefined);
  const acquireRuntimeLifecycleLease = vi.fn(async () => ({
    release: releaseLifecycleLease,
  }));
  const appendLifecycleLog = vi.fn(async () => undefined);
  const attachGracefulShutdownHandlers = vi.fn();
  const toLifecyclePaths = vi.fn((launchConfig) => launchConfig.runtimePaths);

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
    toLifecyclePaths,
  };
});

vi.mock("./app", () => ({
  createApp: mocks.createApp,
}));

vi.mock("./assets", () => ({
  createSpaAssetBinding: mocks.createSpaAssetBinding,
}));

vi.mock("./database", () => ({
  prepareRuntimeDatabase: mocks.prepareRuntimeDatabase,
}));

vi.mock("./rate-limit-storage", () => ({
  createPersistentRuntimeRateLimitStorage:
    mocks.createPersistentRuntimeRateLimitStorage,
}));

vi.mock("./self-host/lifecycle", () => ({
  acquireRuntimeLifecycleLease: mocks.acquireRuntimeLifecycleLease,
  appendLifecycleLog: mocks.appendLifecycleLog,
  attachGracefulShutdownHandlers: mocks.attachGracefulShutdownHandlers,
  toLifecyclePaths: mocks.toLifecyclePaths,
}));

vi.mock("@onequery/server/runtime", () => ({
  createServerRuntimeConfig: mocks.createServerRuntimeConfig,
}));

function writeLaunchConfigFile(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "onequery-bun-index-test-"));
  const launchConfigPath = join(root, "launch.json");

  writeFileSync(launchConfigPath, JSON.stringify(value, null, 2));

  return launchConfigPath;
}

describe("startBunServer", () => {
  const bunServeMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    bunServeMock.mockReset();
    bunServeMock.mockImplementation(({ hostname, port }) => ({
      hostname,
      port,
      stop: vi.fn(),
    }));
    vi.stubGlobal("Bun", {
      serve: bunServeMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

    const { startBunServer } = await import("./index");
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
    });
    expect(bunServeMock).toHaveBeenCalledWith(
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

    const { startBunServer } = await import("./index");
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
