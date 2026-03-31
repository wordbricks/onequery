import { join } from "node:path";

import { createServerRuntimeConfig } from "@onequery/server/runtime";

import { createApp } from "./app";
import { createSpaAssetBinding } from "./assets";
import { DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS } from "./constants";
import { RUNTIME_RATE_LIMIT_STORAGE_DIRNAME } from "./constants";
import { prepareRuntimeDatabase } from "./database";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { loadStartupLaunchConfig } from "./startup";
import { resolveStartupInputFromArgv } from "./startup";
import { createPersistentRuntimeRateLimitStorage } from "./rate-limit-storage";
import {
  acquireRuntimeLifecycleLease,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
} from "./self-host/lifecycle";
import { toLifecyclePaths } from "./self-host/lifecycle";

function createRuntimeRateLimitStorage(
  launchConfig: ServerLaunchConfig
) {
  if (launchConfig.rateLimit.storage !== "persistent") {
    return undefined;
  }

  if (!launchConfig.runtimePaths) {
    throw new Error(
      "Persistent rate limiting requires launchConfig.runtimePaths."
    );
  }

  return createPersistentRuntimeRateLimitStorage(
    join(
      launchConfig.runtimePaths.dataDir,
      RUNTIME_RATE_LIMIT_STORAGE_DIRNAME
    )
  );
}

export async function startBunServer(
  startupInput: Parameters<typeof loadStartupLaunchConfig>[0]
) {
  const launchConfig = loadStartupLaunchConfig(startupInput);
  const selfHostPaths =
    launchConfig.mode === "self-host" ? toLifecyclePaths(launchConfig) : null;
  const lifecycleLogWriter = {
    append(message: string) {
      if (!selfHostPaths) {
        return Promise.resolve();
      }

      return appendLifecycleLog(selfHostPaths, message);
    },
  };
  const lifecycleLease = selfHostPaths
    ? await acquireRuntimeLifecycleLease(selfHostPaths, {
        logWriter: lifecycleLogWriter,
      })
    : null;

  try {
    const runtime = createServerRuntimeConfig(launchConfig, {
      rateLimitStorage: createRuntimeRateLimitStorage(launchConfig),
    });
    // Comment: The Bun runtime is the single owner of main application schema
    // convergence; local bootstrap only guarantees the shared Postgres container.
    await prepareRuntimeDatabase({
      databaseUrl: runtime.storage.connectionString,
    });
    const app = createApp({
      runtime,
      spaAssets: createSpaAssetBinding({
        assetDir: launchConfig.assets.distDir,
      }),
    });

    const server = Bun.serve({
      fetch(request) {
        return app.fetch(request);
      },
      hostname: launchConfig.listen.host,
      idleTimeout: DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS,
      port: launchConfig.listen.port,
    });

    const listenAddress = `http://${server.hostname}:${server.port}`;

    if (lifecycleLease) {
      attachGracefulShutdownHandlers({
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
}

if (import.meta.main) {
  await startBunServer(resolveStartupInputFromArgv(process.argv));
}
