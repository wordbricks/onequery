import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import { SelfHostRuntimePathsMissingError } from "./errors";
import type { LifecycleLaunchConfig, LifecyclePathsResolution } from "./types";

export function toLifecyclePathsResult(
  launchConfig: LifecycleLaunchConfig
): ResultType<LifecyclePathsResolution, SelfHostRuntimePathsMissingError> {
  if (launchConfig.mode !== "self-host") {
    return Result.ok({
      kind: "unmanaged",
    });
  }

  if (!launchConfig.runtimePaths) {
    return Result.err(
      new SelfHostRuntimePathsMissingError({
        message: "Self-host launch config requires runtimePaths.",
      })
    );
  }

  if (!launchConfig.supervisorControl) {
    return Result.err(
      new SelfHostRuntimePathsMissingError({
        message: "Self-host launch config requires supervisorControl.",
      })
    );
  }

  return Result.ok({
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
  });
}

export function toLifecyclePaths(
  launchConfig: LifecycleLaunchConfig
): LifecyclePathsResolution {
  const paths = toLifecyclePathsResult(launchConfig);

  if (paths.isErr()) {
    throw paths.error;
  }

  return paths.value;
}
