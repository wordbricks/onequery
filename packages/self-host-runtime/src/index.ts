import { join } from "node:path";

import { create } from "@bufbuild/protobuf";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import {
  RuntimePhase,
  SupervisorIdentitySchema,
} from "@onequery/proto-runtime/runtime/v1/common_pb";
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
  toLifecyclePathsResult,
} from "./self-host/lifecycle";
import type {
  GracefulShutdownController,
  RuntimeLifecycleLease,
  RuntimeShutdownRequest,
  RuntimeShutdownResource,
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

type SelfHostLaunchConfig = ServerLaunchConfig & {
  launchId: string;
  mode: "self-host";
  runtimePaths: NonNullable<ServerLaunchConfig["runtimePaths"]>;
  supervisorControl: NonNullable<ServerLaunchConfig["supervisorControl"]>;
  supervisor: NonNullable<ServerLaunchConfig["supervisor"]>;
};

type LaunchLifecycleMode =
  | {
      kind: "managed";
      launchConfig: SelfHostLaunchConfig;
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
      storageHandle: ServerStorageHandle;
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
    launchConfig.mode === "self-host" &&
    launchConfig.runtimePaths !== undefined &&
    launchConfig.supervisorControl !== undefined &&
    typeof launchConfig.launchId === "string" &&
    launchConfig.supervisor !== undefined
  );
}

function createSupervisorIdentity(
  supervisor: SelfHostLaunchConfig["supervisor"]
): SupervisorIdentity {
  return create(SupervisorIdentitySchema, {
    generation: BigInt(supervisor.generation),
    pid: supervisor.pid,
    supervisorId: supervisor.supervisorId,
  });
}

function supervisorStopCommandToRuntimeShutdownRequest(
  command: SupervisorStopCommand
): RuntimeShutdownRequest {
  const target =
    command.target && command.target.supervisor
      ? {
          dataDir: command.target.dataDir,
          launchId: command.target.launchId,
          pid: command.target.runtimePid,
          supervisor: command.target.supervisor,
        }
      : undefined;

  return {
    completion: "cleanup_and_exit",
    graceTimeout: command.graceTimeout,
    operationId: command.operationId,
    reason: command.reason,
    target,
  };
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
        "self-host launch config requires runtimePaths, supervisorControl, launchId, and supervisor",
        launchConfig
      )
    );
  }

  const resolution = toLifecyclePathsResult(launchConfig).mapError((cause) =>
    createWorkflowError(
      "resolve_lifecycle_paths",
      "failed to resolve self-host lifecycle paths",
      cause
    )
  );
  if (resolution.isErr()) {
    return Result.err(resolution.error);
  }
  if (resolution.value.kind !== "self-host") {
    return Result.err(
      createWorkflowError(
        "resolve_lifecycle_paths",
        "self-host launch config resolved to unmanaged lifecycle paths",
        resolution.value
      )
    );
  }

  return Result.ok({
    kind: "managed",
    launchConfig,
    lifecyclePaths: resolution.value.paths,
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
        const lifecyclePaths = launchLifecycleMode.lifecyclePaths;
        const logWriter = createLifecycleLogWriter(
          lifecyclePaths,
          dependencies.appendLifecycleLog
        );
        const supervisor = createSupervisorIdentity(
          launchLifecycleMode.launchConfig.supervisor
        );
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

      const listenAddress = `http://${launchConfig.listen.host}:${startedServer.port}`;

      if (lifecycle.kind === "managed") {
        const selfHostLaunchConfig = yield* Result.try({
          try: () => {
            if (!isSelfHostLaunchConfig(launchConfig)) {
              throw new Error(
                "managed lifecycle requires self-host launch config"
              );
            }

            return launchConfig;
          },
          catch: (cause) =>
            createWorkflowError(
              "open_supervisor_session",
              "managed lifecycle is missing self-host launch metadata",
              cause
            ),
        });
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
              launchId: selfHostLaunchConfig.launchId,
              runtimePid: lifecycle.runtimePid,
              runtimeSequence: lifecycle.lease.currentStatus().runtimeSequence,
              onStopCommand: async (command) => {
                await shutdownController.shutdown(
                  supervisorStopCommandToRuntimeShutdownRequest(command)
                );
                return {
                  status: lifecycle.lease.terminalStatus(RuntimePhase.STOPPED),
                };
              },
              supervisor: createSupervisorIdentity(
                selfHostLaunchConfig.supervisor
              ),
            }),
          catch: (cause) =>
            createWorkflowError(
              "open_supervisor_session",
              "failed to open supervisor runtime session",
              cause
            ),
        });
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
      case "serving_managed_starting":
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
  void input.supervisorSession.closed
    .then(
      () =>
        input.shutdownController.shutdown({
          completion: "cleanup_and_exit",
          reason: "supervisor_session_closed",
        }),
      () =>
        input.shutdownController.shutdown({
          completion: "cleanup_and_exit",
          reason: "supervisor_session_failed",
        })
    )
    .catch((cause) => {
      console.error("[runtime] supervisor session shutdown failed", cause);
    });
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
