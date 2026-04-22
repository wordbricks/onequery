import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateServerLaunchConfig } from "@onequery/config/server-launch";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

export class LaunchConfigFileReadError extends TaggedError(
  "LaunchConfigFileReadError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

export class LaunchConfigJsonParseError extends TaggedError(
  "LaunchConfigJsonParseError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

export class LaunchConfigValidationError extends TaggedError(
  "LaunchConfigValidationError"
)<{
  cause: unknown;
  message: string;
  path: string;
}>() {}

export type LoadLaunchConfigFileError =
  | LaunchConfigFileReadError
  | LaunchConfigJsonParseError
  | LaunchConfigValidationError;

export type LoadLaunchConfigFileResult = ResultType<
  ServerLaunchConfig,
  LoadLaunchConfigFileError
>;

export function loadLaunchConfigFileResult(
  path: string
): LoadLaunchConfigFileResult {
  const resolvedPath = resolve(path);

  return Result.gen(function* loadLaunchConfigFileFlow() {
    const contents = yield* Result.try({
      try: () => readFileSync(resolvedPath, "utf8"),
      catch: (cause) =>
        new LaunchConfigFileReadError({
          cause,
          message: `Failed to read launch config file: ${resolvedPath}\n${toErrorMessage(cause)}`,
          path: resolvedPath,
        }),
    });
    const parsed = yield* Result.try({
      try: () => JSON.parse(contents),
      catch: (cause) =>
        new LaunchConfigJsonParseError({
          cause,
          message: `Invalid launch config JSON: ${resolvedPath}\n${toErrorMessage(cause)}`,
          path: resolvedPath,
        }),
    });
    const launchConfig = yield* Result.try({
      try: () => validateServerLaunchConfig(parsed, `file ${resolvedPath}`),
      catch: (cause) =>
        new LaunchConfigValidationError({
          cause,
          message: `Invalid launch config file: ${resolvedPath}\n${toErrorMessage(cause)}`,
          path: resolvedPath,
        }),
    });

    return Result.ok(launchConfig);
  });
}

export function loadLaunchConfigFile(path: string): ServerLaunchConfig {
  const launchConfig = loadLaunchConfigFileResult(path);

  if (launchConfig.isErr()) {
    throw launchConfig.error;
  }

  return launchConfig.value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
