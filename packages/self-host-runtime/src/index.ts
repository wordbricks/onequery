import { dirname, join } from "node:path";

import {
  serverLaunchApiRateLimitStorageLabel,
  viewServerLaunchCommonConfig,
  viewServerLaunchConfig,
} from "@onequery/config/server-launch";
import type {
  ServerLaunchCommonView,
  SelfHostServerLaunchView,
  ServerLaunchView,
} from "@onequery/config/server-launch";
import { RuntimePhase } from "@onequery/proto-runtime/runtime/v1/common_pb";
import type { SupervisorIdentity } from "@onequery/proto-runtime/runtime/v1/common_pb";
import type { SupervisorStopCommand } from "@onequery/proto-runtime/runtime/v1/supervisor_pb";
import { createMemoryApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import type { ApiRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import { createServerRuntimeConfig } from "@onequery/server/runtime";
import type { ServerRuntimeConfig } from "@onequery/server/runtime";
import { createServerStorageHandle } from "@onequery/server/storage";
import type {
  ServerStorage,
  ServerStorageHandle,
} from "@onequery/server/storage";
import { unreachable } from "antiox/panic";
import { JoinError, spawn } from "antiox/task";
import type { JoinHandle } from "antiox/task";
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
  toLifecyclePaths,
} from "./self-host/lifecycle";
import type {
  GracefulShutdownController,
  RuntimeLifecycleLease,
  RuntimeShutdownRequest,
  RuntimeShutdownResource,
  RuntimeShutdownTarget,
  SelfHostLifecyclePaths,
} from "./self-host/lifecycle";
import { createSupervisorLifecycleClient } from "./self-host/supervisor-client/client";
import { openSupervisorRuntimeSession } from "./self-host/supervisor-client/session";
import type { SupervisorRuntimeSession } from "./self-host/supervisor-client/session";
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
  launchId: string;
  lease: RuntimeLifecycleLease;
  logWriter: LifecycleLogWriter;
  runtimePid: number;
  supervisor: SupervisorIdentity;
};

type RuntimeLifecycleContext =
  | ManagedLifecycleContext
  | UnmanagedLifecycleContext;

type LaunchLifecycleMode =
  | {
      kind: "managed";
      launchConfig: SelfHostServerLaunchView;
      lifecyclePaths: SelfHostLifecyclePaths;
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
      lifecycle: RuntimeLifecycleContext;
      status: "storage_created";
      storageHandle: ServerStorageHandle;
    }
  | {
      lifecycle: UnmanagedLifecycleContext;
      server: StartedServer;
      storageHandle: ServerStorageHandle;
      status: "serving_unmanaged";
    }
  | {
      lifecycle: ManagedLifecycleContext;
      server: StartedServer;
      shutdownController?: GracefulShutdownController;
      storageHandle: ServerStorageHandle;
      supervisorSession?: SupervisorRuntimeSession;
      status: "serving_managed_starting";
    }
  | {
      lifecycle: ManagedLifecycleContext;
      server: StartedServer;
      shutdownController: GracefulShutdownController;
      storageHandle: ServerStorageHandle;
      supervisorSession?: SupervisorRuntimeSession;
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
  | "open_supervisor_session"
  | "prepare_database"
  | "report_supervisor_ready"
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
    shutdownResources?: readonly RuntimeShutdownResource[];
  }): GracefulShutdownController;
  createApp(input: {
    runtime: ServerRuntimeConfig;
    spaAssets: SpaAssetBinding;
    storage: ServerStorage;
  }): AppFetchHandler;
  createServerStorageHandle: typeof createServerStorageHandle;
  createServerRuntimeConfig: typeof createServerRuntimeConfig;
  createSpaAssetBindingResult: typeof createSpaAssetBindingResult;
  createSupervisorLifecycleClient: typeof createSupervisorLifecycleClient;
  loadStartupLaunchConfigResult: typeof loadStartupLaunchConfigResult;
  openSupervisorRuntimeSession: typeof openSupervisorRuntimeSession;
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
  createServerStorageHandle,
  createServerRuntimeConfig,
  createSpaAssetBindingResult,
  createSupervisorLifecycleClient,
  loadStartupLaunchConfigResult,
  openSupervisorRuntimeSession,
  prepareRuntimeDatabaseResult,
  serve: serveWithNode,
};

function resolveApiRateLimitStorageResult(
  launchView: ServerLaunchView,
  commonView: ServerLaunchCommonView
): ResultType<ApiRateLimitStorage, PersistentRateLimitStorageConfigError> {
  const rateLimitStorage = resolveApiRateLimitStorageLabel(commonView);
  if (rateLimitStorage.isErr()) {
    return Result.err(rateLimitStorage.error);
  }

  if (rateLimitStorage.value !== "persistent") {
    return Result.ok(createMemoryApiRateLimitStorage());
  }

  if (launchView.mode !== "self-host") {
    return Result.err(
      new PersistentRateLimitStorageConfigError({
        message:
          "Persistent API rate limiting requires self-host runtime paths.",
      })
    );
  }

  return Result.ok(
    createStorage({
      driver: fsLiteDriver({
        base: join(
          dirname(launchView.runtimePaths.runDir),
          "cache",
          RUNTIME_RATE_LIMIT_STORAGE_DIRNAME,
          RUNTIME_RATE_LIMIT_API_DIRNAME
        ),
      }),
    })
  );
}

function resolveApiRateLimitStorageLabel(
  commonView: ServerLaunchCommonView
): ResultType<"memory" | "persistent", PersistentRateLimitStorageConfigError> {
  return Result.try({
    try: () =>
      serverLaunchApiRateLimitStorageLabel(commonView.apiRateLimit.storage),
    catch: (cause) =>
      new PersistentRateLimitStorageConfigError({
        message: toErrorMessage(cause),
      }),
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

function supervisorStopCommandToRuntimeShutdownRequest(
  command: SupervisorStopCommand,
  target: RuntimeShutdownTarget
): RuntimeShutdownRequest {
  return {
    completion: "cleanup_and_exit",
    graceTimeout: command.graceTimeout,
    operationId: command.operationId,
    reason: command.reason,
    target,
  };
}

function resolveLaunchLifecycleModeResult(
  launchView: ServerLaunchView
): ResultType<LaunchLifecycleMode, StartServerWorkflowError> {
  if (launchView.mode !== "self-host") {
    return Result.ok({
      kind: "unmanaged",
    });
  }

  const resolution = toLifecyclePaths(launchView);
  if (resolution.kind !== "self-host") {
    return Result.err(
      createWorkflowError(
        "resolve_lifecycle_paths",
        "self-host launch config resolved to unmanaged lifecycle paths",
        resolution
      )
    );
  }

  return Result.ok({
    kind: "managed",
    launchConfig: launchView,
    lifecyclePaths: resolution.paths,
  });
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

async function closeSupervisorSessionAfterStartupFailure(
  session: SupervisorRuntimeSession
): Promise<ResultType<void, StartServerWorkflowError>> {
  return Result.tryPromise({
    try: async () => {
      await session.close();
    },
    catch: (cause) =>
      createWorkflowError(
        "cleanup_startup_failure",
        "failed to close supervisor runtime session after startup failure",
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

async function closeStorageAfterStartupFailure(
  storageHandle: ServerStorageHandle
): Promise<ResultType<void, StartServerWorkflowError>> {
  return Result.tryPromise({
    try: async () => {
      await storageHandle.close();
    },
    catch: (cause) =>
      createWorkflowError(
        "cleanup_startup_failure",
        "failed to close runtime storage after startup failure",
        cause
      ),
  });
}

async function resolveLifecycleContextResult(
  launchView: ServerLaunchView,
  dependencies: StartServerDependencies
): Promise<ResultType<RuntimeLifecycleContext, StartServerWorkflowError>> {
  return Result.gen(async function* resolveLifecycleContextFlow() {
    const launchLifecycleMode =
      yield* resolveLaunchLifecycleModeResult(launchView);
    switch (launchLifecycleMode.kind) {
      case "unmanaged":
        return Result.ok(createUnmanagedLifecycleContext());
      case "managed": {
        const lifecyclePaths = launchLifecycleMode.lifecyclePaths;
        const logWriter = createLifecycleLogWriter(
          lifecyclePaths,
          dependencies.appendLifecycleLog
        );
        const supervisor = launchLifecycleMode.launchConfig.supervisor;
        const lease = yield* Result.await(
          dependencies
            .acquireRuntimeLifecycleLeaseResult(lifecyclePaths, {
              launchId: launchLifecycleMode.launchConfig.launchId,
              logWriter,
              supervisor,
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
          launchId: launchLifecycleMode.launchConfig.launchId,
          lease,
          logWriter,
          runtimePid: process.pid,
          supervisor,
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
      const launchView = yield* Result.try({
        try: () => viewServerLaunchConfig(launchConfig, "runtime"),
        catch: (cause) =>
          createWorkflowError(
            "load_launch_config",
            "failed to project runtime launch config",
            cause
          ),
      });
      const commonView = yield* Result.try({
        try: () => viewServerLaunchCommonConfig(launchView.common, "runtime"),
        catch: (cause) =>
          createWorkflowError(
            "load_launch_config",
            "failed to project runtime launch config common fields",
            cause
          ),
      });
      const lifecycle = yield* Result.await(
        resolveLifecycleContextResult(launchView, resolvedDependencies)
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
            migrationsDir: commonView.migrations.dir,
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

      const apiRateLimitStorage = yield* resolveApiRateLimitStorageResult(
        launchView,
        commonView
      );
      const storageHandle = yield* Result.try({
        try: () =>
          resolvedDependencies.createServerStorageHandle(
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
      startupShellRef.current = {
        lifecycle,
        status: "storage_created",
        storageHandle,
      };
      const spaAssets = yield* resolvedDependencies
        .createSpaAssetBindingResult({
          assetDir: commonView.assets.distDir,
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
            storage: storageHandle.storage,
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
              hostname: commonView.listen.host,
              idleTimeout: DEFAULT_SERVER_IDLE_TIMEOUT_SECONDS,
              port: commonView.listen.port,
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
          storageHandle,
          status: "serving_managed_starting",
        };
      } else {
        startupShellRef.current = {
          lifecycle,
          server: startedServer,
          storageHandle,
          status: "serving_unmanaged",
        };
      }

      const listenAddress = `http://${commonView.listen.host}:${startedServer.port}`;

      if (lifecycle.kind === "managed") {
        const shutdownController = yield* Result.try({
          try: () =>
            resolvedDependencies.attachGracefulShutdownHandlers({
              lease: lifecycle.lease,
              logWriter: lifecycle.logWriter,
              server: startedServer,
              shutdownResources: [
                {
                  close: () => storageHandle.close(),
                  failureCode: "checkpoint_failed",
                  name: "server-storage",
                },
              ],
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
          storageHandle,
          status: "serving_managed_starting",
        };
        const supervisorClient = yield* Result.try({
          try: () =>
            resolvedDependencies.createSupervisorLifecycleClient({
              endpoint: lifecycle.lease.paths.controlEndpoint,
            }),
          catch: (cause) =>
            createWorkflowError(
              "open_supervisor_session",
              "failed to create supervisor lifecycle client",
              cause
            ),
        });
        const supervisorSession = yield* Result.try({
          try: () =>
            resolvedDependencies.openSupervisorRuntimeSession({
              client: supervisorClient,
              dataDir: lifecycle.lease.paths.dataDir,
              launchId: lifecycle.launchId,
              runtimePid: lifecycle.runtimePid,
              runtimeSequence: lifecycle.lease.currentStatus().runtimeSequence,
              onStopCommand: async (command) => {
                await shutdownController.shutdown(
                  supervisorStopCommandToRuntimeShutdownRequest(command, {
                    dataDir: lifecycle.lease.paths.dataDir,
                    launchId: lifecycle.launchId,
                    pid: lifecycle.runtimePid,
                    supervisor: lifecycle.supervisor,
                  })
                );
                return {
                  status: lifecycle.lease.terminalStatus(RuntimePhase.STOPPED),
                };
              },
              supervisor: lifecycle.supervisor,
            }),
          catch: (cause) =>
            createWorkflowError(
              "open_supervisor_session",
              "failed to open supervisor runtime session",
              cause
            ),
        });
        startupShellRef.current = {
          lifecycle,
          server: startedServer,
          shutdownController,
          storageHandle,
          supervisorSession,
          status: "serving_managed_starting",
        };
        yield* Result.await(
          Result.tryPromise({
            try: () => supervisorSession.opened,
            catch: (cause) =>
              createWorkflowError(
                "open_supervisor_session",
                "failed to open supervisor runtime session",
                cause
              ),
          })
        );
        startupShellRef.current = {
          lifecycle,
          server: startedServer,
          shutdownController,
          storageHandle,
          supervisorSession,
          status: "serving_managed",
        };
        const readyStatus = yield* Result.await(
          Result.tryPromise({
            try: () => lifecycle.lease.transition(RuntimePhase.READY),
            catch: (cause) =>
              createWorkflowError(
                "transition_lifecycle_ready",
                "failed to mark runtime lifecycle as ready",
                cause
              ),
          })
        );
        yield* Result.await(
          Result.tryPromise({
            try: () => supervisorSession.ready(readyStatus),
            catch: (cause) =>
              createWorkflowError(
                "report_supervisor_ready",
                "failed to report runtime ready status to supervisor session",
                cause
              ),
          })
        );
        observeSupervisorSessionClosed({
          shutdownController,
          supervisorSession,
        });
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
      case "storage_created": {
        const closeStorageResult = await closeStorageAfterStartupFailure(
          startupShell.storageHandle
        );
        if (closeStorageResult.isErr()) {
          cleanupErrors.push(closeStorageResult.error);
        }
        break;
      }
      case "serving_managed": {
        startupShell.shutdownController.dispose();
        if (startupShell.supervisorSession !== undefined) {
          const closeSupervisorSessionResult =
            await closeSupervisorSessionAfterStartupFailure(
              startupShell.supervisorSession
            );
          if (closeSupervisorSessionResult.isErr()) {
            cleanupErrors.push(closeSupervisorSessionResult.error);
          }
        }
        const stopServerResult = await stopServerAfterStartupFailure(
          startupShell.server
        );
        if (stopServerResult.isErr()) {
          cleanupErrors.push(stopServerResult.error);
        }
        const closeStorageResult = await closeStorageAfterStartupFailure(
          startupShell.storageHandle
        );
        if (closeStorageResult.isErr()) {
          cleanupErrors.push(closeStorageResult.error);
        }
        break;
      }
      case "serving_managed_starting": {
        startupShell.shutdownController?.dispose();
        if (startupShell.supervisorSession !== undefined) {
          const closeSupervisorSessionResult =
            await closeSupervisorSessionAfterStartupFailure(
              startupShell.supervisorSession
            );
          if (closeSupervisorSessionResult.isErr()) {
            cleanupErrors.push(closeSupervisorSessionResult.error);
          }
        }
        const stopServerResult = await stopServerAfterStartupFailure(
          startupShell.server
        );
        if (stopServerResult.isErr()) {
          cleanupErrors.push(stopServerResult.error);
        }
        const closeStorageResult = await closeStorageAfterStartupFailure(
          startupShell.storageHandle
        );
        if (closeStorageResult.isErr()) {
          cleanupErrors.push(closeStorageResult.error);
        }
        break;
      }
      case "serving_unmanaged": {
        const stopServerResult = await stopServerAfterStartupFailure(
          startupShell.server
        );
        if (stopServerResult.isErr()) {
          cleanupErrors.push(stopServerResult.error);
        }
        const closeStorageResult = await closeStorageAfterStartupFailure(
          startupShell.storageHandle
        );
        if (closeStorageResult.isErr()) {
          cleanupErrors.push(closeStorageResult.error);
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

function observeSupervisorSessionClosed(input: {
  shutdownController: GracefulShutdownController;
  supervisorSession: SupervisorRuntimeSession;
}): void {
  const sessionClosed = Result.tryPromise({
    try: () => input.supervisorSession.closed,
    catch: (cause) => cause,
  });
  const observerTask = spawn(async () => {
    const closed = await sessionClosed;
    await input.shutdownController.shutdown({
      completion: "cleanup_and_exit",
      reason: closed.isOk()
        ? "supervisor_session_closed"
        : "supervisor_session_failed",
    });
  });
  observeBackgroundTask(
    observerTask,
    "[runtime] supervisor session shutdown failed"
  );
}

function observeBackgroundTask(
  handle: JoinHandle<void>,
  failureMessage: string
): void {
  void Result.tryPromise({
    try: async () => {
      await handle;
    },
    catch: (cause) => {
      console.error(failureMessage, unwrapJoinError(cause));
    },
  });
}

function unwrapJoinError(cause: unknown): unknown {
  return cause instanceof JoinError && cause.cause !== undefined
    ? cause.cause
    : cause;
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
