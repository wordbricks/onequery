import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  validateServerLaunchConfig,
  type ServerLaunchConfig,
} from "@onequery/config/server-launch";

export function validateLaunchConfig(
  value: unknown,
  source: string
): ServerLaunchConfig {
  return validateServerLaunchConfig(value, source);
}

export function loadLaunchConfigFile(path: string): ServerLaunchConfig {
  const resolvedPath = resolve(path);
  let contents: string;

  try {
    contents = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read launch config file: ${resolvedPath}\n${(error as Error).message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Invalid launch config JSON: ${resolvedPath}\n${(error as Error).message}`
    );
  }

  return validateServerLaunchConfig(parsed, `file ${resolvedPath}`);
}
