import type { ResolvedWorkspaceDevConfig } from "./workspace-dev";

const TEST_DATABASE_NAME = "test";
const TEST_DATABASE_PASSWORD = "test";
const TEST_DATABASE_USER = "test";

export interface DerivedTestProfile {
  readonly database: {
    readonly database: string;
    readonly host: string;
    readonly password: string;
    readonly port: number;
    readonly url: string;
    readonly user: string;
  };
  readonly profile: "test";
}

export function deriveTestProfile(
  workspaceDev: ResolvedWorkspaceDevConfig
): DerivedTestProfile {
  return {
    database: {
      database: TEST_DATABASE_NAME,
      host: workspaceDev.postgres.host,
      password: TEST_DATABASE_PASSWORD,
      port: workspaceDev.postgres.hostPort,
      url: `postgres://${TEST_DATABASE_USER}:${TEST_DATABASE_PASSWORD}@${workspaceDev.postgres.host}:${workspaceDev.postgres.hostPort}/${TEST_DATABASE_NAME}`,
      user: TEST_DATABASE_USER,
    },
    profile: "test",
  };
}
