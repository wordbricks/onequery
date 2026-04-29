import type {
  ServerLaunchSupervisorControlConfig,
  ServerLaunchView,
} from "@onequery/config/server-launch";
import { RuntimePhase } from "@onequery/proto-runtime/runtime/v1/common_pb";
import type {
  RuntimeStatus,
  SupervisorIdentity,
} from "@onequery/proto-runtime/runtime/v1/common_pb";

export type RuntimeSupervisorIdentity = Pick<
  SupervisorIdentity,
  "generation" | "pid" | "supervisorId"
>;

export type SupervisorControlEndpoint = ServerLaunchSupervisorControlConfig;

export interface SelfHostLifecyclePaths {
  controlEndpoint: SupervisorControlEndpoint;
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
  pid: number;
  supervisor: RuntimeSupervisorIdentity;
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
  supervisor: SupervisorIdentity;
}

export interface CleanupOptions {
  reason: string;
  stopServer: boolean;
}

// Internal lifecycle phases are the generated runtime contract values. The
// reducer still owns legal transitions; the proto enum owns vocabulary.
export type RuntimeLifecyclePhase =
  | RuntimePhase.CHECKPOINTING
  | RuntimePhase.DRAINING
  | RuntimePhase.READY
  | RuntimePhase.SHUTDOWN_FAILED
  | RuntimePhase.STARTING
  | RuntimePhase.STOPPED
  | RuntimePhase.STOPPING;

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
  ): Promise<RuntimeStatus>;
  currentStatus(): RuntimeStatus;
  terminalStatus(
    phase: Extract<
      RuntimeLifecyclePhase,
      RuntimePhase.SHUTDOWN_FAILED | RuntimePhase.STOPPED
    >,
    failure?: RuntimeLifecycleFailure
  ): RuntimeStatus;
  release(options: CleanupOptions): Promise<void>;
}

export interface RuntimeLifecycleDurableLease extends RuntimeLifecycleLease {
  persistTransition(
    transition: RuntimeLifecycleTransitionPersistence
  ): Promise<RuntimeStatus>;
}

export interface GracefulShutdownController {
  dispose(): void;
  shutdown(request: RuntimeShutdownRequest): Promise<void>;
}

export type LifecycleLaunchConfig = ServerLaunchView;
