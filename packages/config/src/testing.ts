import type { ServerLaunchConfig } from "./server-launch";

// Comment: This must stay valid base64 because runtime credential tests derive
// the AES key directly from config values.
export const SAMPLE_MASTER_ENCRYPTION_KEY =
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

export function createWorkspaceDevLaunchConfig(input?: {
  assetsDistDir?: string;
  authSecret?: string;
  connectorEnrollmentToken?: string;
  host?: string;
  masterEncryptionKey?: string;
  migrationsDir?: string;
  port?: number;
  postgresUrl?: string;
  publicOrigin?: string;
  rateLimit?: ServerLaunchConfig["rateLimit"];
}): ServerLaunchConfig {
  return {
    assets: {
      distDir: input?.assetsDistDir ?? "/tmp/onequery/runtime/web",
    },
    auth: {
      secret: input?.authSecret ?? "workspace-auth-secret",
    },
    connectors: {
      enrollmentToken: input?.connectorEnrollmentToken ?? "connector-token",
    },
    crypto: {
      masterEncryptionKey:
        input?.masterEncryptionKey ?? SAMPLE_MASTER_ENCRYPTION_KEY,
    },
    listen: {
      host: input?.host ?? "127.0.0.1",
      port: input?.port ?? 4555,
    },
    migrations: {
      dir: input?.migrationsDir ?? "/tmp/onequery/runtime/migrations",
    },
    mode: "workspace-dev",
    publicOrigin: input?.publicOrigin ?? "http://localhost:4545",
    rateLimit: input?.rateLimit ?? {
      enabled: false,
      storage: "memory",
    },
    storage: {
      kind: "postgres",
      url:
        input?.postgresUrl ??
        "postgres://onequery:onequery@localhost:5454/onequery",
    },
  };
}

export function createSelfHostRuntimePaths(input?: {
  backupsDir?: string;
  dataDir?: string;
  lockPath?: string;
  logsDir?: string;
  pidPath?: string;
  runDir?: string;
}): NonNullable<ServerLaunchConfig["runtimePaths"]> {
  return {
    backupsDir: input?.backupsDir ?? "/tmp/onequery/backups",
    dataDir: input?.dataDir ?? "/tmp/onequery/data",
    lockPath: input?.lockPath ?? "/tmp/onequery/run/server.lock",
    logsDir: input?.logsDir ?? "/tmp/onequery/logs",
    pidPath: input?.pidPath ?? "/tmp/onequery/run/server.pid",
    runDir: input?.runDir ?? "/tmp/onequery/run",
  };
}

export function createSelfHostSmtpConfig(input?: {
  fromEmail?: string;
  fromName?: string;
  host?: string;
  password?: string;
  port?: number;
  secure?: boolean;
  username?: string;
}): NonNullable<ServerLaunchConfig["smtp"]> {
  return {
    fromEmail: input?.fromEmail ?? "hello@example.com",
    fromName: input?.fromName,
    host: input?.host ?? "smtp.example.com",
    password: input?.password,
    port: input?.port ?? 587,
    secure: input?.secure,
    username: input?.username,
  };
}

export function createSelfHostLaunchConfig(input?: {
  assetsDistDir?: string;
  authSecret?: string;
  connectorEnrollmentToken?: string;
  host?: string;
  masterEncryptionKey?: string;
  migrationsDir?: string;
  port?: number;
  publicOrigin?: string;
  rateLimit?: ServerLaunchConfig["rateLimit"];
  runtimePaths?: NonNullable<ServerLaunchConfig["runtimePaths"]>;
  smtp?: NonNullable<ServerLaunchConfig["smtp"]>;
  storageDir?: string;
}): ServerLaunchConfig {
  return {
    assets: {
      distDir: input?.assetsDistDir ?? "/tmp/onequery/runtime/web",
    },
    auth: {
      secret: input?.authSecret ?? "self-host-auth-secret",
    },
    connectors: {
      enrollmentToken: input?.connectorEnrollmentToken ?? "connector-token",
    },
    crypto: {
      masterEncryptionKey:
        input?.masterEncryptionKey ?? SAMPLE_MASTER_ENCRYPTION_KEY,
    },
    listen: {
      host: input?.host ?? "127.0.0.1",
      port: input?.port ?? 5656,
    },
    migrations: {
      dir: input?.migrationsDir ?? "/tmp/onequery/runtime/migrations",
    },
    mode: "self-host",
    publicOrigin: input?.publicOrigin ?? "http://127.0.0.1:5656",
    rateLimit: input?.rateLimit ?? {
      enabled: true,
      storage: "persistent",
    },
    runtimePaths: input?.runtimePaths ?? createSelfHostRuntimePaths(),
    smtp: input?.smtp,
    storage: {
      dir: input?.storageDir ?? "/tmp/onequery/pglite",
      kind: "pglite",
    },
  };
}
