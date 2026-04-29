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
      api: {
        storage: "memory",
      },
      enabled: false,
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
  lifecycleEventLogPath?: string;
  logsDir?: string;
  runDir?: string;
  runtimeLeasePath?: string;
  runtimeStatusSnapshotPath?: string;
}): NonNullable<ServerLaunchConfig["runtimePaths"]> {
  return {
    backupsDir: input?.backupsDir ?? "/tmp/onequery/backups",
    dataDir: input?.dataDir ?? "/tmp/onequery",
    lifecycleEventLogPath:
      input?.lifecycleEventLogPath ?? "/tmp/onequery/run/lifecycle.events.pb",
    logsDir: input?.logsDir ?? "/tmp/onequery/logs",
    runDir: input?.runDir ?? "/tmp/onequery/run",
    runtimeLeasePath:
      input?.runtimeLeasePath ?? "/tmp/onequery/run/runtime.lease.json",
    runtimeStatusSnapshotPath:
      input?.runtimeStatusSnapshotPath ??
      "/tmp/onequery/run/runtime.status.json",
  };
}

export function createSelfHostRuntimeControl(input?: {
  socketPath?: string;
}): NonNullable<ServerLaunchConfig["runtimeControl"]> {
  return {
    transport: {
      kind: "unix",
      socketPath: input?.socketPath ?? "/tmp/onequery/run/runtime-control.sock",
    },
  };
}

export function createSelfHostSupervisor(input?: {
  generation?: string;
  pid?: number;
  supervisorId?: string;
}): NonNullable<ServerLaunchConfig["supervisor"]> {
  return {
    generation: input?.generation ?? "7",
    pid: input?.pid ?? 1001,
    supervisorId: input?.supervisorId ?? "gateway-supervisor:1001",
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
  launchId?: string;
  masterEncryptionKey?: string;
  migrationsDir?: string;
  port?: number;
  publicOrigin?: string;
  rateLimit?: ServerLaunchConfig["rateLimit"];
  runtimeControl?: NonNullable<ServerLaunchConfig["runtimeControl"]>;
  runtimePaths?: NonNullable<ServerLaunchConfig["runtimePaths"]>;
  smtp?: NonNullable<ServerLaunchConfig["smtp"]>;
  storageDir?: string;
  supervisor?: NonNullable<ServerLaunchConfig["supervisor"]>;
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
    launchId: input?.launchId ?? "test-self-host-launch",
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
      api: {
        storage: "persistent",
      },
      enabled: true,
    },
    runtimeControl: input?.runtimeControl ?? createSelfHostRuntimeControl(),
    runtimePaths: input?.runtimePaths ?? createSelfHostRuntimePaths(),
    smtp: input?.smtp,
    storage: {
      dir: input?.storageDir ?? "/tmp/onequery/pglite/onequery",
      kind: "pglite",
    },
    supervisor: input?.supervisor ?? createSelfHostSupervisor(),
  };
}
