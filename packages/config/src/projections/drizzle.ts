import type { ResolvedWorkspaceDevConfig } from "../workspace-dev";

export interface DrizzleConfigProjection {
  readonly databaseUrl: string;
}

export function projectDrizzleConfig(
  workspaceDev: ResolvedWorkspaceDevConfig
): DrizzleConfigProjection {
  return {
    databaseUrl: workspaceDev.postgres.url,
  };
}
