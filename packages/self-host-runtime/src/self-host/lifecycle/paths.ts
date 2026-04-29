import type { LifecycleLaunchConfig, LifecyclePathsResolution } from "./types";

export function toLifecyclePaths(
  launchConfig: LifecycleLaunchConfig
): LifecyclePathsResolution {
  if (launchConfig.mode !== "self-host") {
    return {
      kind: "unmanaged",
    };
  }

  return {
    kind: "self-host",
    paths: {
      controlEndpoint: launchConfig.supervisorControl,
      dataDir: launchConfig.runtimePaths.dataDir,
      lifecycleEventLogPath: launchConfig.runtimePaths.lifecycleEventLogPath,
      logsDir: launchConfig.runtimePaths.logsDir,
      runtimeLeasePath: launchConfig.runtimePaths.runtimeLeasePath,
      runtimeStatusSnapshotPath:
        launchConfig.runtimePaths.runtimeStatusSnapshotPath,
    },
  };
}
