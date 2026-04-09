import { join } from "node:path";

import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { createMemoryApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import type { ApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import { createServerRuntimeConfig } from "@onequery/server/runtime";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import { createServerStorage } from "@onequery/server/storage";
import type { ServerStorage } from "@onequery/server/storage";
import { createStorage } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";

import { createApp } from "./app";
import { createSpaAssetBinding } from "./assets";
import {
  DEFAULT_SERVER_IDLE_TIMEOUT_SECONDS,
  RUNTIME_RATE_LIMIT_API_DIRNAME,
  RUNTIME_RATE_LIMIT_STORAGE_DIRNAME,
} from "./constants";
import { prepareRuntimeDatabase } from "./database";
import {
  acquireRuntimeLifecycleLease,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
  toLifecyclePaths,
} from "./self-host/lifecycle";
import type { RuntimeLifecycleLease } from "./self-host/lifecycle";
import { loadStartupLaunchConfig } from "./startup";
import type { ServerStartupInput } from "./startup";

type AppFetchHandler = {
  fetch(request: Request): Response | Promise<Response>;
};

const RUNTIME_LOG_PREFIX = "[onequery-server]";

type StartedServer = {
  hostname: string;
  port: number;
  stop(closeActiveConnections?: boolean): Promise<void> | void;
};

type LifecycleLogWriter = {
  append(message: string): Promise<void>;
};

export interface StartServerDependencies {
  acquireRuntimeLifecycleLease: typeof acquireRuntimeLifecycleLease;
  appendLifecycleLog: typeof appendLifecycleLog;
  attachGracefulShutdownHandlers(args: {
    lease: RuntimeLifecycleLease;
    logWriter: LifecycleLogWriter;
    server: StartedServer;
  }): unknown;
  createApp(input: {
    runtime: ServerRuntimeConfig;
    spaAssets: AppFetchHandler;
    storage?: ServerStorage;
  }): AppFetchHandler;
  createServerStorage: typeof createServerStorage;
  createServerRuntimeConfig: typeof createServerRuntimeConfig;
  createSpaAssetBinding(options: { assetDir: string }): AppFetchHandler;
  loadStartupLaunchConfig: typeof loadStartupLaunchConfig;
  prepareRuntimeDatabase: typeof prepareRuntimeDatabase;
  serve(options: {
    fetch(request: Request): Response | Promise<Response>;
    hostname: string;
    idleTimeout: number;
    port: number;
  }): StartedServer | Promise<StartedServer>;
  toLifecyclePaths: typeof toLifecyclePaths;
}

const defaultStartServerDependencies: StartServerDependencies = {
  acquireRuntimeLifecycleLease,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
  createApp,
  createServerStorage,
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
        return Promise.resolve(server.stop(closeActiveConnections)).then(
          () => undefined
        );
      },
    };
  },
  toLifecyclePaths,
};

function resolveApiRateLimitStorage(
  launchConfig: ServerLaunchConfig
): ApiRateLimitStorage {
  if (launchConfig.rateLimit.api.storage !== "persistent") {
    return createMemoryApiRateLimitStorage();
  }

  if (!launchConfig.runtimePaths) {
    throw new Error(
      "Persistent API rate limiting requires launchConfig.runtimePaths."
    );
  }

  return createStorage({
    driver: fsLiteDriver({
      base: join(
        launchConfig.runtimePaths.dataDir,
        RUNTIME_RATE_LIMIT_STORAGE_DIRNAME,
        RUNTIME_RATE_LIMIT_API_DIRNAME
      ),
    }),
  });
}

function createLifecycleLogWriter(
  selfHostPaths: ReturnType<StartServerDependencies["toLifecyclePaths"]> | null,
  append: StartServerDependencies["appendLifecycleLog"]
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

export function createStartServer(
  dependencies: Partial<StartServerDependencies> = {}
) {
  const resolvedDependencies = {
    ...defaultStartServerDependencies,
    ...dependencies,
  } satisfies StartServerDependencies;

  return async function startServer(startupInput: ServerStartupInput) {
    const launchConfig =
      resolvedDependencies.loadStartupLaunchConfig(startupInput);
    const selfHostPaths =
      launchConfig.mode === "self-host"
        ? resolvedDependencies.toLifecyclePaths(launchConfig)
        : null;
    const lifecycleLogWriter = createLifecycleLogWriter(
      selfHostPaths,
      resolvedDependencies.appendLifecycleLog
    );
    const lifecycleLease = selfHostPaths
      ? await resolvedDependencies.acquireRuntimeLifecycleLease(selfHostPaths, {
          logWriter: lifecycleLogWriter,
        })
      : null;

    try {
      const runtime =
        resolvedDependencies.createServerRuntimeConfig(launchConfig);
      // Comment: The launched runtime process is the single owner of main
      // application schema convergence; local bootstrap only guarantees the
      // shared Postgres container.
      await resolvedDependencies.prepareRuntimeDatabase({
        databaseUrl: runtime.storage.connectionString,
        migrationsDir: launchConfig.migrations.dir,
      });
      const storage = resolvedDependencies.createServerStorage(
        runtime,
        resolveApiRateLimitStorage(launchConfig)
      );
      const app = resolvedDependencies.createApp({
        runtime,
        spaAssets: resolvedDependencies.createSpaAssetBinding({
          assetDir: launchConfig.assets.distDir,
        }),
        storage,
      });

      const server = await resolvedDependencies.serve({
        fetch(request) {
          return app.fetch(request);
        },
        hostname: launchConfig.listen.host,
        idleTimeout: DEFAULT_SERVER_IDLE_TIMEOUT_SECONDS,
        port: launchConfig.listen.port,
      });

      const listenAddress = `http://${launchConfig.listen.host}:${server.port}`;

      if (lifecycleLease) {
        resolvedDependencies.attachGracefulShutdownHandlers({
          lease: lifecycleLease,
          logWriter: lifecycleLogWriter,
          server,
        });
      }

      await lifecycleLogWriter.append(
        `${RUNTIME_LOG_PREFIX} listening on ${listenAddress}`
      );
      console.log(`${RUNTIME_LOG_PREFIX} listening on ${listenAddress}`);

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

export const startServer = createStartServer();
