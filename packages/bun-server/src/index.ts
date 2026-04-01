import { join } from "node:path";

import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { createServerRuntimeConfig } from "@onequery/server/runtime";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";

import { createApp } from "./app";
import { createSpaAssetBinding } from "./assets";
import {
  DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS,
  RUNTIME_RATE_LIMIT_STORAGE_DIRNAME,
} from "./constants";
import { prepareRuntimeDatabase } from "./database";
import { createPersistentRuntimeRateLimitStorage } from "./rate-limit-storage";
import {
  acquireRuntimeLifecycleLease,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
  toLifecyclePaths,
} from "./self-host/lifecycle";
import type { RuntimeLifecycleLease } from "./self-host/lifecycle";
import {
  loadStartupLaunchConfig,
  resolveStartupInputFromArgv,
} from "./startup";
import type { BunServerStartupInput } from "./startup";

type AppFetchHandler = {
  fetch(request: Request): Response | Promise<Response>;
};

type StartBunServerHandle = {
  hostname: string;
  port: number;
  stop(closeActiveConnections?: boolean): void;
};

type LifecycleLogWriter = {
  append(message: string): Promise<void>;
};

export interface StartBunServerDependencies {
  acquireRuntimeLifecycleLease: typeof acquireRuntimeLifecycleLease;
  appendLifecycleLog: typeof appendLifecycleLog;
  attachGracefulShutdownHandlers(args: {
    lease: RuntimeLifecycleLease;
    logWriter: LifecycleLogWriter;
    server: StartBunServerHandle;
  }): unknown;
  createApp(input: {
    runtime: ServerRuntimeConfig;
    spaAssets: AppFetchHandler;
  }): AppFetchHandler;
  createPersistentRuntimeRateLimitStorage: typeof createPersistentRuntimeRateLimitStorage;
  createServerRuntimeConfig: typeof createServerRuntimeConfig;
  createSpaAssetBinding(options: { assetDir: string }): AppFetchHandler;
  loadStartupLaunchConfig: typeof loadStartupLaunchConfig;
  prepareRuntimeDatabase: typeof prepareRuntimeDatabase;
  serve(options: {
    fetch(request: Request): Response | Promise<Response>;
    hostname: string;
    idleTimeout: number;
    port: number;
  }): StartBunServerHandle;
  toLifecyclePaths: typeof toLifecyclePaths;
}

const defaultStartBunServerDependencies: StartBunServerDependencies = {
  acquireRuntimeLifecycleLease,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
  createApp,
  createPersistentRuntimeRateLimitStorage,
  createServerRuntimeConfig,
  createSpaAssetBinding,
  loadStartupLaunchConfig,
  prepareRuntimeDatabase,
  serve(options) {
    const server = Bun.serve(options);

    return {
      hostname: server.hostname ?? options.hostname,
      port: server.port ?? options.port,
      stop(closeActiveConnections) {
        server.stop(closeActiveConnections);
      },
    };
  },
  toLifecyclePaths,
};

function createRuntimeRateLimitStorage(
  launchConfig: ServerLaunchConfig,
  createPersistentStorage: StartBunServerDependencies["createPersistentRuntimeRateLimitStorage"]
) {
  if (launchConfig.rateLimit.storage !== "persistent") {
    return undefined;
  }

  if (!launchConfig.runtimePaths) {
    throw new Error(
      "Persistent rate limiting requires launchConfig.runtimePaths."
    );
  }

  return createPersistentStorage(
    join(launchConfig.runtimePaths.dataDir, RUNTIME_RATE_LIMIT_STORAGE_DIRNAME)
  );
}

function createLifecycleLogWriter(
  selfHostPaths: ReturnType<
    StartBunServerDependencies["toLifecyclePaths"]
  > | null,
  append: StartBunServerDependencies["appendLifecycleLog"]
): LifecycleLogWriter {
  return {
    append(message: string) {
      if (!selfHostPaths) {
        return Promise.resolve();
      }

      return append(selfHostPaths, message);
    },
  };
}

export function createStartBunServer(
  dependencies: StartBunServerDependencies = defaultStartBunServerDependencies
) {
  return async function startBunServer(startupInput: BunServerStartupInput) {
    const launchConfig = dependencies.loadStartupLaunchConfig(startupInput);
    const selfHostPaths =
      launchConfig.mode === "self-host"
        ? dependencies.toLifecyclePaths(launchConfig)
        : null;
    const lifecycleLogWriter = createLifecycleLogWriter(
      selfHostPaths,
      dependencies.appendLifecycleLog
    );
    const lifecycleLease = selfHostPaths
      ? await dependencies.acquireRuntimeLifecycleLease(selfHostPaths, {
          logWriter: lifecycleLogWriter,
        })
      : null;

    try {
      const runtime = dependencies.createServerRuntimeConfig(launchConfig, {
        rateLimitStorage: createRuntimeRateLimitStorage(
          launchConfig,
          dependencies.createPersistentRuntimeRateLimitStorage
        ),
      });
      // Comment: The Bun runtime is the single owner of main application schema
      // convergence; local bootstrap only guarantees the shared Postgres container.
      await dependencies.prepareRuntimeDatabase({
        databaseUrl: runtime.storage.connectionString,
      });
      const app = dependencies.createApp({
        runtime,
        spaAssets: dependencies.createSpaAssetBinding({
          assetDir: launchConfig.assets.distDir,
        }),
      });

      const server = dependencies.serve({
        fetch(request) {
          return app.fetch(request);
        },
        hostname: launchConfig.listen.host,
        idleTimeout: DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS,
        port: launchConfig.listen.port,
      });

      const listenAddress = `http://${launchConfig.listen.host}:${server.port}`;

      if (lifecycleLease) {
        dependencies.attachGracefulShutdownHandlers({
          lease: lifecycleLease,
          logWriter: lifecycleLogWriter,
          server,
        });
      }

      await lifecycleLogWriter.append(
        `[bun-server] listening on ${listenAddress}`
      );
      console.log(`[bun-server] listening on ${listenAddress}`);

      return server;
    } catch (error) {
      if (lifecycleLease) {
        await lifecycleLease.release({
          reason: "startup_failure",
          stopServer: false,
        });
      }
      throw error;
    }
  };
}

export const startBunServer = createStartBunServer();

if (import.meta.main) {
  await startBunServer(resolveStartupInputFromArgv(process.argv));
}
