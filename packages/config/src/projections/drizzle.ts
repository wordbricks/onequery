import type { ResolvedWorkspaceDevConfig } from "../workspace-dev";

export interface DrizzleConfigProjection {
  readonly databaseUrl: string;
  readonly pgliteDir: string;
}

export function projectDrizzleConfig(
  _workspaceDev: ResolvedWorkspaceDevConfig,
  options: {
    readonly storageDir: string;
  }
): DrizzleConfigProjection {
  return {
    databaseUrl: `pglite:${options.storageDir}`,
    pgliteDir: options.storageDir,
  };
}
