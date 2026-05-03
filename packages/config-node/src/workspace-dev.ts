import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readTomlFileSync } from "@onequery/config-loader";
import type { TomlFileData } from "@onequery/config-loader";
import {
  formatWorkspaceDevIssuePath,
  parseWorkspaceDev,
  WORKSPACE_DEV_HOME_DIRNAME,
  WORKSPACE_DEV_PROFILE_DIRNAME,
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
  readonly profileDir: string;
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
    `Profile dir: ${paths.profileDir}`,
    `Secrets file: ${paths.secretsPath}`,
    ...issues,
  ].join("\n");
}

function renderWorkspaceDevReadError(input: {
  readonly error: unknown;
  readonly paths: WorkspaceDevPaths;
}): string {
  return [
    "Failed to load workspace-dev config.",
    `Profile dir: ${input.paths.profileDir}`,
    `Secrets file: ${input.paths.secretsPath}`,
    `- secrets: ${
      input.error instanceof Error ? input.error.message : String(input.error)
    }`,
  ].join("\n");
}

function readWorkspaceDevSecrets(paths: WorkspaceDevPaths): TomlFileData {
  try {
    return readOptionalTomlFile(paths.secretsPath);
  } catch (error) {
    throw new Error(renderWorkspaceDevReadError({ error, paths }), {
      cause: error,
    });
  }
}

export function resolveWorkspaceDevPaths(
  rootDir: string = defaultRootDir
): WorkspaceDevPaths {
  const profileDir = resolve(
    rootDir,
    WORKSPACE_DEV_HOME_DIRNAME,
    WORKSPACE_DEV_PROFILE_DIRNAME
  );

  return {
    profileDir,
    rootDir,
    secretsPath: resolve(profileDir, WORKSPACE_DEV_SECRETS_FILENAME),
  };
}

export function loadWorkspaceDev(
  input: LoadWorkspaceDevOptions = {}
): ResolvedWorkspaceDevConfig {
  const paths = resolveWorkspaceDevPaths(input.rootDir);
  const result = parseWorkspaceDev({
    secrets: readWorkspaceDevSecrets(paths),
  });

  if (!result.ok) {
    throw new Error(renderWorkspaceDevParseError(result.error, paths));
  }

  return result.value;
}
