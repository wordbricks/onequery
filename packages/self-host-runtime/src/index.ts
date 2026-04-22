import { join } from "node:path";

import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { createMemoryApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import type { ApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import { createServerRuntimeConfig } from "@onequery/server/runtime";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import { createServerStorage } from "@onequery/server/storage";
import type { ServerStorage } from "@onequery/server/storage";
import { unreachable } from "antiox/panic";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { createStorage } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";

import { createApp } from "./app";
import { createSpaAssetBindingResult } from "./assets";
import {
  DEFAULT_SERVER_IDLE_TIMEOUT_SECONDS,
  RUNTIME_RATE_LIMIT_API_DIRNAME,
  RUNTIME_RATE_LIMIT_STORAGE_DIRNAME,
} from "./constants";
import { prepareRuntimeDatabaseResult } from "./database";
import { serveWithNode } from "./node-serve";
import {
  acquireRuntimeLifecycleLeaseResult,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
} from "./self-host/lifecycle";
import type {
  GracefulShutdownController,
  RuntimeLifecycleLease,
  SelfHostLifecyclePaths,
} from "./self-host/lifecycle";
import { loadStartupLaunchConfigResult } from "./startup";
import type { ServerStartupInput } from "./startup";

type AppFetchHandler = {
  fetch: (request: Request, env?: object) => Response | Promise<Response>;
};

type SpaAssetBinding = {
  fetch: (request: Request) => Promise<Response>;
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

type UnmanagedLifecycleContext = {
  kind: "unmanaged";
  logWriter: LifecycleLogWriter;
};

type ManagedLifecycleContext = {
  kind: "managed";
  lease: RuntimeLifecycleLease;
  logWriter: LifecycleLogWriter;
};

type RuntimeLifecycleContext =
  | ManagedLifecycleContext
  | UnmanagedLifecycleContext;

type SelfHostLaunchConfig = ServerLaunchConfig & {
  mode: "self-host";
  runtimePaths: NonNullable<ServerLaunchConfig["runtimePaths"]>;
};

type LaunchLifecycleMode =
  | {
      kind: "managed";
      launchConfig: SelfHostLaunchConfig;
    }
  | {
      kind: "unmanaged";
    };

type ServerStartupShell =
  | {
      lifecycle: RuntimeLifecycleContext;
      status: "initial";
    }
  | {
      lifecycle: UnmanagedLifecycleContext;
      server: StartedServer;
      status: "serving_unmanaged";
    }
  | {
      lifecycle: ManagedLifecycleContext;
      server: StartedServer;
      status: "serving_managed_starting";
    }
  | {
      lifecycle: ManagedLifecycleContext;
      server: StartedServer;
      shutdownController: GracefulShutdownController;
      status: "serving_managed";
    };

type StartServerWorkflowStep =
  | "acquire_lifecycle_lease"
  | "attach_shutdown_handlers"
  | "cleanup_startup_failure"
  | "create_app"
  | "create_runtime_config"
  | "create_spa_assets"
  | "create_storage"
  | "load_launch_config"
  | "prepare_database"
  | "resolve_lifecycle_paths"
  | "serve"
  | "transition_lifecycle_ready"
  | "write_listen_log";

export class PersistentRateLimitStorageConfigError extends TaggedError(
  "PersistentRateLimitStorageConfigError"
)<{
  message: string;
}>() {}

export class StartServerWorkflowError extends TaggedError(
  "StartServerWorkflowError"
)<{
  cause: unknown;
  message: string;
  step: StartServerWorkflowStep;
}>() {}

export type StartServerError =
  | PersistentRateLimitStorageConfigError
  | StartServerWorkflowError;

export interface StartServerDependencies {
  acquireRuntimeLifecycleLeaseResult: typeof acquireRuntimeLifecycleLeaseResult;
  appendLifecycleLog: typeof appendLifecycleLog;
  attachGracefulShutdownHandlers(args: {
    lease: RuntimeLifecycleLease;
    logWriter: LifecycleLogWriter;
    server: StartedServer;
  }): GracefulShutdownController;
  createApp(input: {
    runtime: ServerRuntimeConfig;
    spaAssets: SpaAssetBinding;
    storage: ServerStorage;
  }): AppFetchHandler;
  createServerStorage: typeof createServerStorage;
  createServerRuntimeConfig: typeof createServerRuntimeConfig;
  createSpaAssetBindingResult: typeof createSpaAssetBindingResult;
  loadStartupLaunchConfigResult: typeof loadStartupLaunchConfigResult;
  prepareRuntimeDatabaseResult: typeof prepareRuntimeDatabaseResult;
  serve(options: {
    fetch: (request: Request, env?: object) => Response | Promise<Response>;
    hostname: string;
    idleTimeout: number;
    port: number;
  }): StartedServer | Promise<StartedServer>;
}

const defaultStartServerDependencies: StartServerDependencies = {
  acquireRuntimeLifecycleLeaseResult,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
  createApp,
  createServerStorage,
  createServerRuntimeConfig,
  createSpaAssetBindingResult,
  loadStartupLaunchConfigResult,
  prepareRuntimeDatabaseResult,
  serve: serveWithNode,
};

function resolveApiRateLimitStorageResult(
  launchConfig: ServerLaunchConfig
): ResultType<ApiRateLimitStorage, PersistentRateLimitStorageConfigError> {
  if (launchConfig.rateLimit.api.storage !== "persistent") {
    return Result.ok(createMemoryApiRateLimitStorage());
  }

  if (!launchConfig.runtimePaths) {
    return Result.err(
      new PersistentRateLimitStorageConfigError({
        message:
          "Persistent API rate limiting requires launchConfig.runtimePaths.",
      })
    );
  }

  return Result.ok(
    createStorage({
      driver: fsLiteDriver({
        base: join(
          launchConfig.runtimePaths.dataDir,
          RUNTIME_RATE_LIMIT_STORAGE_DIRNAME,
          RUNTIME_RATE_LIMIT_API_DIRNAME
        ),
      }),
    })
  );
}

function createLifecycleLogWriter(
  selfHostPaths: SelfHostLifecyclePaths,
  append: StartServerDependencies["appendLifecycleLog"]
): LifecycleLogWriter {
  return {
    append(message: string) {
      return append(selfHostPaths, message);
    },
  };
}

const noopLifecycleLogWriter: LifecycleLogWriter = {
  append: async () => {},
};

function createUnmanagedLifecycleContext(): UnmanagedLifecycleContext {
  return {
    kind: "unmanaged",
    logWriter: noopLifecycleLogWriter,
  };
}

function isSelfHostLaunchConfig(
  launchConfig: ServerLaunchConfig
): launchConfig is SelfHostLaunchConfig {
  return (
    launchConfig.mode === "self-host" && launchConfig.runtimePaths !== undefined
  );
}

function resolveLaunchLifecycleModeResult(
  launchConfig: ServerLaunchConfig
): ResultType<LaunchLifecycleMode, StartServerWorkflowError> {
  if (launchConfig.mode !== "self-host") {
    return Result.ok({
      kind: "unmanaged",
    });
  }

  if (!isSelfHostLaunchConfig(launchConfig)) {
    return Result.err(
      createWorkflowError(
        "resolve_lifecycle_paths",
        "self-host launch config requires runtimePaths",
        launchConfig
      )
    );
  }

  return Result.ok({
    kind: "managed",
    launchConfig,
  });
}

function createSelfHostLifecyclePaths(
  launchConfig: SelfHostLaunchConfig
): SelfHostLifecyclePaths {
  return {
    dataDir: launchConfig.runtimePaths.dataDir,
    lockPath: launchConfig.runtimePaths.lockPath,
    logsDir: launchConfig.runtimePaths.logsDir,
    pidPath: launchConfig.runtimePaths.pidPath,
  };
}

function createWorkflowError(
  step: StartServerWorkflowStep,
  message: string,
  cause: unknown
) {
  return new StartServerWorkflowError({
    cause,
    message,
    step,
  });
}

async function stopServerAfterStartupFailure(
  server: StartedServer
): Promise<ResultType<void, StartServerWorkflowError>> {
  return Result.tryPromise({
    try: async () => {
      await server.stop(true);
    },
    catch: (cause) =>
      createWorkflowError(
        "cleanup_startup_failure",
        "failed to stop runtime server after startup failure",
        cause
      ),
  });
}

async function releaseLifecycleLeaseAfterStartupFailure(
  lease: RuntimeLifecycleLease
): Promise<ResultType<void, StartServerWorkflowError>> {
  return Result.tryPromise({
    try: async () => {
      await lease.release({
        reason: "startup_failure",
        stopServer: false,
      });
    },
    catch: (cause) =>
      createWorkflowError(
        "cleanup_startup_failure",
        "failed to release lifecycle lease after startup failure",
        cause
      ),
  });
}

async function resolveLifecycleContextResult(
  launchConfig: ServerLaunchConfig,
  dependencies: StartServerDependencies
): Promise<ResultType<RuntimeLifecycleContext, StartServerWorkflowError>> {
  return Result.gen(async function* resolveLifecycleContextFlow() {
    const launchLifecycleMode =
      yield* resolveLaunchLifecycleModeResult(launchConfig);
    switch (launchLifecycleMode.kind) {
      case "unmanaged":
        return Result.ok(createUnmanagedLifecycleContext());
      case "managed": {
        const lifecyclePaths = createSelfHostLifecyclePaths(
          launchLifecycleMode.launchConfig
        );
        const logWriter = createLifecycleLogWriter(
          lifecyclePaths,
          dependencies.appendLifecycleLog
        );
        const lease = yield* Result.await(
          dependencies
            .acquireRuntimeLifecycleLeaseResult(lifecyclePaths, {
              logWriter,
            })
            .then((result) =>
              result.mapError((cause) =>
                createWorkflowError(
                  "acquire_lifecycle_lease",
                  `failed to acquire self-host lifecycle lease for ${lifecyclePaths.dataDir}`,
                  cause
                )
              )
            )
        );

        return Result.ok({
          kind: "managed",
          lease,
          logWriter,
        } satisfies ManagedLifecycleContext);
      }
      default:
        return unreachable(launchLifecycleMode);
    }
  });
}

export function createStartServerResult(
  dependencies: Partial<StartServerDependencies> = {}
) {
  const resolvedDependencies = {
    ...defaultStartServerDependencies,
    ...dependencies,
  } satisfies StartServerDependencies;

  return async function startServerResult(
    startupInput: ServerStartupInput
  ): Promise<ResultType<StartedServer, StartServerError>> {
    const startupShellRef: { current: ServerStartupShell } = {
      current: {
        lifecycle: createUnmanagedLifecycleContext(),
        status: "initial",
      },
    };

    const workflow = await Result.gen(async function* startServerFlow() {
      const launchConfig = yield* resolvedDependencies
        .loadStartupLaunchConfigResult(startupInput)
        .mapError((cause) =>
          createWorkflowError(
            "load_launch_config",
            "failed to load runtime launch config",
            cause
          )
        );
      const lifecycle = yield* Result.await(
        resolveLifecycleContextResult(launchConfig, resolvedDependencies)
      );
      startupShellRef.current = {
        lifecycle,
        status: "initial",
      };

      const runtime = yield* Result.try({
        try: () => resolvedDependencies.createServerRuntimeConfig(launchConfig),
        catch: (cause) =>
          createWorkflowError(
            "create_runtime_config",
            "failed to create runtime config",
            cause
          ),
      });
      // Comment: The launched runtime process is the single owner of main
      // application schema convergence; local bootstrap only guarantees the
      // shared Postgres container.
      yield* Result.await(
        resolvedDependencies
          .prepareRuntimeDatabaseResult({
            databaseUrl: runtime.storage.connectionString,
            migrationsDir: launchConfig.migrations.dir,
          })
          .then((result) =>
            result.mapError((cause) =>
              createWorkflowError(
                "prepare_database",
                "failed to prepare runtime database",
                cause
              )
            )
          )
      );

      const apiRateLimitStorage =
        yield* resolveApiRateLimitStorageResult(launchConfig);
      const storage = yield* Result.try({
        try: () =>
          resolvedDependencies.createServerStorage(
            runtime,
            apiRateLimitStorage
          ),
        catch: (cause) =>
          createWorkflowError(
            "create_storage",
            "failed to create runtime storage",
            cause
          ),
      });
      const spaAssets = yield* resolvedDependencies
        .createSpaAssetBindingResult({
          assetDir: launchConfig.assets.distDir,
        })
        .mapError((cause) =>
          createWorkflowError(
            "create_spa_assets",
            "failed to bind runtime SPA assets",
            cause
          )
        );
      const app = yield* Result.try({
        try: () =>
          resolvedDependencies.createApp({
            runtime,
            spaAssets,
            storage,
          }),
        catch: (cause) =>
          createWorkflowError(
            "create_app",
            "failed to create runtime app",
            cause
          ),
      });

      const startedServer = yield* Result.await(
        Result.tryPromise({
          try: async () =>
            resolvedDependencies.serve({
              fetch: app.fetch.bind(app),
              hostname: launchConfig.listen.host,
              idleTimeout: DEFAULT_SERVER_IDLE_TIMEOUT_SECONDS,
              port: launchConfig.listen.port,
            }),
          catch: (cause) =>
            createWorkflowError(
              "serve",
              "failed to start runtime server",
              cause
            ),
        })
      );
      if (lifecycle.kind === "managed") {
        startupShellRef.current = {
          lifecycle,
          server: startedServer,
          status: "serving_managed_starting",
        };
      } else {
        startupShellRef.current = {
          lifecycle,
          server: startedServer,
          status: "serving_unmanaged",
        };
      }

      const listenAddress = `http://${launchConfig.listen.host}:${startedServer.port}`;

      if (lifecycle.kind === "managed") {
        const shutdownController = yield* Result.try({
          try: () =>
            resolvedDependencies.attachGracefulShutdownHandlers({
              lease: lifecycle.lease,
              logWriter: lifecycle.logWriter,
              server: startedServer,
            }),
          catch: (cause) =>
            createWorkflowError(
              "attach_shutdown_handlers",
              "failed to attach runtime shutdown handlers",
              cause
            ),
        });
        startupShellRef.current = {
          lifecycle,
          server: startedServer,
          shutdownController,
          status: "serving_managed",
        };
        yield* Result.await(
          Result.tryPromise({
            try: () => lifecycle.lease.transition("ready"),
            catch: (cause) =>
              createWorkflowError(
                "transition_lifecycle_ready",
                "failed to mark runtime lifecycle as ready",
                cause
              ),
          })
        );
      }

      yield* Result.await(
        Result.tryPromise({
          try: () =>
            lifecycle.logWriter.append(
              `${RUNTIME_LOG_PREFIX} listening on ${listenAddress}`
            ),
          catch: (cause) =>
            createWorkflowError(
              "write_listen_log",
              `failed to append runtime listen log for ${listenAddress}`,
              cause
            ),
        })
      );
      console.log(`${RUNTIME_LOG_PREFIX} listening on ${listenAddress}`);

      return Result.ok(startedServer);
    });

    if (workflow.isOk()) {
      return workflow;
    }

    const cleanupErrors: StartServerError[] = [workflow.error];
    const startupShell = startupShellRef.current;

    switch (startupShell.status) {
      case "initial":
        break;
      case "serving_managed": {
        startupShell.shutdownController.dispose();
        const stopServerResult = await stopServerAfterStartupFailure(
          startupShell.server
        );
        if (stopServerResult.isErr()) {
          cleanupErrors.push(stopServerResult.error);
        }
        break;
      }
      case "serving_managed_starting":
      case "serving_unmanaged": {
        const stopServerResult = await stopServerAfterStartupFailure(
          startupShell.server
        );
        if (stopServerResult.isErr()) {
          cleanupErrors.push(stopServerResult.error);
        }
        break;
      }
      default:
        return unreachable(startupShell);
    }

    if (startupShell.lifecycle.kind === "managed") {
      const releaseLeaseResult = await releaseLifecycleLeaseAfterStartupFailure(
        startupShell.lifecycle.lease
      );
      if (releaseLeaseResult.isErr()) {
        cleanupErrors.push(releaseLeaseResult.error);
      }
    }

    if (cleanupErrors.length === 1) {
      return workflow;
    }

    return Result.err(
      createWorkflowError(
        "cleanup_startup_failure",
        "runtime startup failed and cleanup also failed",
        new AggregateError(cleanupErrors, "startup failed and cleanup failed")
      )
    );
  };
}

export function createStartServer(
  dependencies: Partial<StartServerDependencies> = {}
) {
  const startServerResult = createStartServerResult(dependencies);

  return async function startServer(startupInput: ServerStartupInput) {
    const startedServer = await startServerResult(startupInput);

    if (startedServer.isErr()) {
      throw startedServer.error;
    }

    return startedServer.value;
  };
}

export const startServerResult = createStartServerResult();
export const startServer = createStartServer();
