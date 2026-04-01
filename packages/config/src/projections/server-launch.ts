import { resolve } from "node:path";

import type {
  ServerLaunchConfig,
  ServerLaunchSmtpConfig,
} from "../server-launch";
import type { ResolvedWorkspaceDevConfig } from "../workspace-dev";

export interface ProjectWorkspaceDevServerLaunchConfigOptions {
  readonly assetDir: string;
  readonly migrationsDir: string;
  readonly smtp?: ServerLaunchSmtpConfig;
}

export function projectWorkspaceDevServerLaunchConfig(
  workspaceDev: ResolvedWorkspaceDevConfig,
  options: ProjectWorkspaceDevServerLaunchConfigOptions
): ServerLaunchConfig {
  return {
    assets: {
      distDir: resolve(options.assetDir),
    },
    auth: {
      secret: workspaceDev.auth.secret,
    },
    connectors: {
      enrollmentToken: workspaceDev.connectors.enrollmentToken,
    },
    crypto: {
      masterEncryptionKey: workspaceDev.crypto.masterEncryptionKey,
    },
    listen: workspaceDev.api.listen,
    migrations: {
      dir: resolve(options.migrationsDir),
    },
    mode: "workspace-dev",
    publicOrigin: workspaceDev.publicOrigin,
    rateLimit: {
      enabled: !workspaceDev.flags.disableRateLimit,
      storage: "memory",
    },
    smtp: options.smtp,
    storage: {
      kind: "postgres",
      url: workspaceDev.postgres.url,
    },
  };
}
