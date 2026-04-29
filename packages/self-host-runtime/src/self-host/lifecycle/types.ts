import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import type { SupervisorIdentity } from "@onequery/proto-runtime/runtime/v1/common_pb";

export type RuntimeControlEndpoint = NonNullable<
  ServerLaunchConfig["runtimeControl"]
>;

export interface SelfHostLifecyclePaths {
  controlEndpoint: RuntimeControlEndpoint;
  dataDir: string;
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
  name: string;
}

export type RuntimeShutdownCompletion = "cleanup_only" | "cleanup_and_exit";

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

export type RuntimeLifecyclePhase =
  | "checkpointing"
  | "draining"
  | "ready"
  | "shutdown_failed"
  | "starting"
  | "stopping";

export interface RuntimeLifecycleLease {
  paths: SelfHostLifecyclePaths;
  transition(phase: RuntimeLifecyclePhase): Promise<void>;
  release(options: CleanupOptions): Promise<void>;
}

export interface GracefulShutdownController {
  dispose(): void;
  shutdown(
    reason: string,
    completion?: RuntimeShutdownCompletion
  ): Promise<void>;
}

export type LifecycleLaunchConfig = Pick<
  ServerLaunchConfig,
  "mode" | "runtimeControl" | "runtimePaths"
>;
