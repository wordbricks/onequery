import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import type {
  LoadLaunchConfigFileError,
  LoadLaunchConfigFileResult,
} from "./launch-config";
import { loadLaunchConfigFileResult } from "./launch-config";

export type ServerStartupInput =
  | {
      launchConfig: ServerLaunchConfig;
    }
  | {
      launchConfigPath: string;
    };

export class MissingLaunchConfigPathError extends TaggedError(
  "MissingLaunchConfigPathError"
)<{
  argv: readonly string[];
  message: string;
}>() {}

export type ResolveStartupInputError = MissingLaunchConfigPathError;

export type ResolveStartupInputResult = ResultType<
  ServerStartupInput,
  ResolveStartupInputError
>;

export type LoadStartupLaunchConfigError = LoadLaunchConfigFileError;

export type LoadStartupLaunchConfigResult = LoadLaunchConfigFileResult;

export function loadStartupLaunchConfigResult(
  input: ServerStartupInput
): LoadStartupLaunchConfigResult {
  if ("launchConfig" in input) {
    return Result.ok(input.launchConfig);
  }

  return loadLaunchConfigFileResult(input.launchConfigPath);
}

export function loadStartupLaunchConfig(
  input: ServerStartupInput
): ServerLaunchConfig {
  const launchConfig = loadStartupLaunchConfigResult(input);

  if (launchConfig.isErr()) {
    throw launchConfig.error;
  }

  return launchConfig.value;
}

export function resolveStartupInputFromArgvResult(
  argv: readonly string[]
): ResolveStartupInputResult {
  const launchConfigPath = argv[2]?.trim();

  if (!launchConfigPath) {
    return Result.err(
      new MissingLaunchConfigPathError({
        argv,
        message:
          "Missing launch config path. Start the packaged server with a serialized launch config file path.",
      })
    );
  }

  return Result.ok({
    launchConfigPath,
  });
}

export function resolveStartupInputFromArgv(
  argv: readonly string[]
): ServerStartupInput {
  const startupInput = resolveStartupInputFromArgvResult(argv);

  if (startupInput.isErr()) {
    throw startupInput.error;
  }

  return startupInput.value;
}
