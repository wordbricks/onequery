import type { ResolvedWorkspaceDevConfig } from "../workspace-dev";

export interface DockerComposeProjection {
  readonly environment: {
    readonly POSTGRES_DB: string;
    readonly POSTGRES_PASSWORD: string;
    readonly POSTGRES_USER: string;
  };
  readonly postgres: {
    readonly containerPort: number;
    readonly hostPort: number;
    readonly portBinding: string;
  };
}

export function projectDockerComposeConfig(
  workspaceDev: ResolvedWorkspaceDevConfig
): DockerComposeProjection {
  return {
    environment: {
      POSTGRES_DB: workspaceDev.postgres.database,
      POSTGRES_PASSWORD: workspaceDev.postgres.password,
      POSTGRES_USER: workspaceDev.postgres.user,
    },
    postgres: {
      containerPort: workspaceDev.postgres.containerPort,
      hostPort: workspaceDev.postgres.hostPort,
      portBinding: workspaceDev.postgres.portBinding,
    },
  };
}
