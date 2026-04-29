import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import type { SupervisorIdentity } from "@onequery/proto-runtime/runtime/v1/common_pb";

export type RuntimeControlEndpoint = NonNullable<
  ServerLaunchConfig["runtimeControl"]
>;

export interface SelfHostLifecyclePaths {
  controlEndpoint: RuntimeControlEndpoint;
  dataDir: string;
  lifecycleEventLogPath: string;
  logsDir: string;
  runtimeLeasePath: string;
  runtimeStatusSnapshotPath: string;
}

export type LifecyclePathsResolution =
  | {
      kind: "self-host";
      paths: SelfHostLifecyclePaths;
    }
  | {
      kind: "unmanaged";
    };

export interface LifecycleLogWriter {
  append(message: string): Promise<void>;
}

export interface ProcessSignalSource {
  off(event: "SIGINT" | "SIGTERM", listener: () => void): this;
  once(event: "SIGINT" | "SIGTERM", listener: () => void): this;
}

export interface ServerHandle {
  stop(closeActiveConnections?: boolean): Promise<void> | void;
}

export interface RuntimeShutdownResource {
  close(): Promise<void> | void;
  failureCode?: Extract<
    RuntimeLifecycleFailureCode,
    "checkpoint_failed" | "resource_close_failed"
  >;
  name: string;
}

export type RuntimeShutdownCompletion = "cleanup_only" | "cleanup_and_exit";

export interface RuntimeShutdownGraceTimeout {
  nanos: number;
  seconds: bigint;
}

export interface RuntimeShutdownTarget {
  dataDir: string;
  launchId: string;
  pid?: number;
  supervisorGeneration?: bigint;
  supervisorPid?: number;
}

export interface RuntimeShutdownRequest {
  completion: RuntimeShutdownCompletion;
  graceTimeout?: RuntimeShutdownGraceTimeout;
  operationId?: string;
  reason: string;
  target?: RuntimeShutdownTarget;
}

export interface LifecycleOptions {
  isProcessRunning?: (pid: number) => boolean;
  launchId: string;
  logWriter?: LifecycleLogWriter;
  now?: () => Date;
  pid?: number;
  supervisor?: SupervisorIdentity;
}

export interface CleanupOptions {
  reason: string;
  stopServer: boolean;
}

// Internal lifecycle phases owned by the runtime shutdown reducer. Durable
// records map these string states to generated RuntimePhase values in
// lifecycle/records.ts; terminal actor-only states stay in runtime-control.
export type RuntimeLifecyclePhase =
  | "checkpointing"
  | "draining"
  | "ready"
  | "shutdown_failed"
  | "starting"
  | "stopping";

export type RuntimeLifecycleFailureCode =
  | "checkpoint_failed"
  | "internal"
  | "resource_close_failed"
  | "shutdown_rejected"
  | "shutdown_timeout";

export interface RuntimeLifecycleFailure {
  code: RuntimeLifecycleFailureCode;
  message: string;
  retryable: boolean;
}

export interface RuntimeLifecycleTransitionPersistence {
  occurredAt: Date;
  failure?: RuntimeLifecycleFailure;
  phase: RuntimeLifecyclePhase;
  runtimeSequence: bigint;
}

export interface RuntimeLifecycleLease {
  paths: SelfHostLifecyclePaths;
  transition(
    phase: RuntimeLifecyclePhase,
    failure?: RuntimeLifecycleFailure
  ): Promise<void>;
  release(options: CleanupOptions): Promise<void>;
}

export interface RuntimeLifecycleDurableLease extends RuntimeLifecycleLease {
  persistTransition(
    transition: RuntimeLifecycleTransitionPersistence
  ): Promise<void>;
}

export interface GracefulShutdownController {
  dispose(): void;
  shutdown(request: RuntimeShutdownRequest): Promise<void>;
}

export type LifecycleLaunchConfig = Pick<
  ServerLaunchConfig,
  "mode" | "runtimeControl" | "runtimePaths"
>;
