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

  if (!launchConfig.runtimeControl) {
    return Result.err(
      new SelfHostRuntimePathsMissingError({
        message: "Self-host launch config requires runtimeControl.",
      })
    );
  }

  return Result.ok({
    kind: "self-host",
    paths: {
      controlEndpoint: launchConfig.runtimeControl,
      dataDir: launchConfig.runtimePaths.dataDir,
      lockPath: launchConfig.runtimePaths.lockPath,
      logsDir: launchConfig.runtimePaths.logsDir,
      pidPath: launchConfig.runtimePaths.pidPath,
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
