import type { ServerLaunchConfig } from "@onequery/config/server-launch";

import { loadLaunchConfigFile } from "./launch-config";

export type BunServerStartupInput =
  | {
      launchConfig: ServerLaunchConfig;
    }
  | {
      launchConfigPath: string;
    };

export function loadStartupLaunchConfig(
  input: BunServerStartupInput
): ServerLaunchConfig {
  if ("launchConfig" in input) {
    return input.launchConfig;
  }

  return loadLaunchConfigFile(input.launchConfigPath);
}

export function resolveStartupInputFromArgv(
  argv: readonly string[]
): BunServerStartupInput {
  const launchConfigPath = argv[2]?.trim();

  if (!launchConfigPath) {
    throw new Error(
      "Missing launch config path. Start bun-server with a serialized launch config file path."
    );
  }

  return {
    launchConfigPath,
  };
}
