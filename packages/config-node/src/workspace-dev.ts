import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readTomlFileSync } from "@onequery/config-loader";
import type { TomlFileData } from "@onequery/config-loader";
import {
  formatWorkspaceDevIssuePath,
  parseWorkspaceDev,
  WORKSPACE_DEV_CONFIG_FILENAME,
  WORKSPACE_DEV_SECRETS_FILENAME,
} from "@onequery/config/workspace-dev";
import type {
  ResolvedWorkspaceDevConfig,
  WorkspaceDevParseError,
} from "@onequery/config/workspace-dev";

const defaultRootDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

export interface WorkspaceDevPaths {
  readonly configPath: string;
  readonly rootDir: string;
  readonly secretsPath: string;
}

export interface LoadWorkspaceDevOptions {
  readonly rootDir?: string;
}

function readOptionalTomlFile(path: string): TomlFileData {
  return existsSync(path) ? readTomlFileSync(path) : {};
}

function renderWorkspaceDevParseError(
  error: WorkspaceDevParseError,
  paths: WorkspaceDevPaths
): string {
  const issues = error.issues.map((issue) => {
    const location =
      issue.path.length === 0
        ? issue.source
        : `${issue.source}.${formatWorkspaceDevIssuePath(issue.path)}`;

    return `- ${location}: ${issue.message}`;
  });

  return [
    "Invalid workspace-dev config.",
    `Config file: ${paths.configPath}`,
    `Secrets file: ${paths.secretsPath}`,
    ...issues,
  ].join("\n");
}

function renderWorkspaceDevReadError(input: {
  readonly error: unknown;
  readonly paths: WorkspaceDevPaths;
  readonly source: "config" | "secrets";
}): string {
  return [
    "Failed to load workspace-dev config.",
    `Config file: ${input.paths.configPath}`,
    `Secrets file: ${input.paths.secretsPath}`,
    `- ${input.source}: ${
      input.error instanceof Error ? input.error.message : String(input.error)
    }`,
  ].join("\n");
}

function readWorkspaceDevSource(input: {
  readonly path: string;
  readonly paths: WorkspaceDevPaths;
  readonly source: "config" | "secrets";
}): TomlFileData {
  try {
    return readOptionalTomlFile(input.path);
  } catch (error) {
    throw new Error(renderWorkspaceDevReadError({ ...input, error }), {
      cause: error,
    });
  }
}

export function resolveWorkspaceDevPaths(
  rootDir: string = defaultRootDir
): WorkspaceDevPaths {
  return {
    configPath: resolve(rootDir, WORKSPACE_DEV_CONFIG_FILENAME),
    rootDir,
    secretsPath: resolve(rootDir, WORKSPACE_DEV_SECRETS_FILENAME),
  };
}

export function loadWorkspaceDev(
  input: LoadWorkspaceDevOptions = {}
): ResolvedWorkspaceDevConfig {
  const paths = resolveWorkspaceDevPaths(input.rootDir);
  const result = parseWorkspaceDev({
    config: readWorkspaceDevSource({
      path: paths.configPath,
      paths,
      source: "config",
    }),
    secrets: readWorkspaceDevSource({
      path: paths.secretsPath,
      paths,
      source: "secrets",
    }),
  });

  if (!result.ok) {
    throw new Error(renderWorkspaceDevParseError(result.error, paths));
  }

  return result.value;
}
