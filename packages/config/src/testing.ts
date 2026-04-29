import { create } from "@bufbuild/protobuf";
import { SupervisorIdentitySchema } from "@onequery/proto-runtime/runtime/v1/common_pb";
import type { SupervisorIdentity } from "@onequery/proto-runtime/runtime/v1/common_pb";
import {
  SelfHostServerLaunchConfigSchema,
  ServerLaunchApiRateLimitConfigSchema,
  ServerLaunchApiRateLimitStorage,
  ServerLaunchCommonConfigSchema,
  ServerLaunchConfigSchema,
  ServerLaunchRateLimitConfigSchema,
  ServerLaunchRuntimePathsConfigSchema,
  ServerLaunchSmtpConfigSchema,
  ServerLaunchStorageConfigSchema,
  ServerLaunchSupervisorControlConfigSchema,
  ServerLaunchSupervisorControlTransportConfigSchema,
  WorkspaceDevServerLaunchConfigSchema,
} from "@onequery/proto-runtime/runtime/v1/launch_pb";

import { decodeMasterEncryptionKey } from "./server-launch";
import type {
  ServerLaunchCommonConfig,
  ServerLaunchConfig,
  ServerLaunchRateLimitStorage,
  ServerLaunchRuntimePathsConfig,
  ServerLaunchSmtpConfig,
  ServerLaunchStorageConfig,
  ServerLaunchSupervisorControlConfig,
} from "./server-launch";

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
  rateLimit?: {
    enabled?: boolean;
    storage?: ServerLaunchRateLimitStorage;
  };
}): ServerLaunchConfig {
  return create(ServerLaunchConfigSchema, {
    profile: {
      case: "workspaceDev",
      value: create(WorkspaceDevServerLaunchConfigSchema, {
        common: createServerLaunchCommonConfig({
          assetsDistDir: input?.assetsDistDir ?? "/tmp/onequery/runtime/web",
          authSecret: input?.authSecret ?? "workspace-auth-secret",
          connectorEnrollmentToken:
            input?.connectorEnrollmentToken ?? "connector-token",
          host: input?.host ?? "127.0.0.1",
          masterEncryptionKey:
            input?.masterEncryptionKey ?? SAMPLE_MASTER_ENCRYPTION_KEY,
          migrationsDir:
            input?.migrationsDir ?? "/tmp/onequery/runtime/migrations",
          port: input?.port ?? 4555,
          publicOrigin: input?.publicOrigin ?? "http://localhost:4545",
          rateLimitEnabled: input?.rateLimit?.enabled ?? false,
          rateLimitStorage: input?.rateLimit?.storage ?? "memory",
          storage: createPostgresStorageConfig({
            url:
              input?.postgresUrl ??
              "postgres://onequery:onequery@localhost:5454/onequery",
          }),
        }),
      }),
    },
  });
}

export function createSelfHostRuntimePaths(input?: {
  backupsDir?: string;
  dataDir?: string;
  lifecycleEventLogPath?: string;
  logsDir?: string;
  runDir?: string;
  runtimeLeasePath?: string;
  runtimeStatusSnapshotPath?: string;
}): ServerLaunchRuntimePathsConfig {
  return create(ServerLaunchRuntimePathsConfigSchema, {
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
  });
}

export function createSelfHostSupervisorControl(input?: {
  baseUrl?: string;
  maxMessageBytes?: number;
  socketPath?: string;
}): ServerLaunchSupervisorControlConfig {
  return create(ServerLaunchSupervisorControlConfigSchema, {
    baseUrl: input?.baseUrl ?? "http://onequery-supervisor",
    maxMessageBytes: input?.maxMessageBytes ?? 64 * 1024,
    transport: create(ServerLaunchSupervisorControlTransportConfigSchema, {
      kind: {
        case: "unix",
        value: {
          socketPath:
            input?.socketPath ?? "/tmp/onequery/run/supervisor-control.sock",
        },
      },
    }),
  });
}

export function createSelfHostSupervisor(input?: {
  generation?: bigint;
  pid?: number;
  supervisorId?: string;
}): SupervisorIdentity {
  return create(SupervisorIdentitySchema, {
    generation: input?.generation ?? 7n,
    pid: input?.pid ?? 1001,
    supervisorId: input?.supervisorId ?? "gateway-supervisor:1001",
  });
}

export function createSelfHostSmtpConfig(input?: {
  fromEmail?: string;
  fromName?: string;
  host?: string;
  password?: string;
  port?: number;
  secure?: boolean;
  username?: string;
}): ServerLaunchSmtpConfig {
  return create(ServerLaunchSmtpConfigSchema, {
    fromEmail: input?.fromEmail ?? "hello@example.com",
    host: input?.host ?? "smtp.example.com",
    port: input?.port ?? 587,
    ...(input?.fromName === undefined ? {} : { fromName: input.fromName }),
    ...(input?.password === undefined ? {} : { password: input.password }),
    ...(input?.secure === undefined ? {} : { secure: input.secure }),
    ...(input?.username === undefined ? {} : { username: input.username }),
  });
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
  rateLimit?: {
    enabled?: boolean;
    storage?: ServerLaunchRateLimitStorage;
  };
  runtimePaths?: ServerLaunchRuntimePathsConfig;
  smtp?: ServerLaunchSmtpConfig;
  storageDir?: string;
  supervisorControl?: ServerLaunchSupervisorControlConfig;
  supervisor?: SupervisorIdentity;
}): ServerLaunchConfig {
  return create(ServerLaunchConfigSchema, {
    profile: {
      case: "selfHost",
      value: create(SelfHostServerLaunchConfigSchema, {
        common: createServerLaunchCommonConfig({
          assetsDistDir: input?.assetsDistDir ?? "/tmp/onequery/runtime/web",
          authSecret: input?.authSecret ?? "self-host-auth-secret",
          connectorEnrollmentToken:
            input?.connectorEnrollmentToken ?? "connector-token",
          host: input?.host ?? "127.0.0.1",
          masterEncryptionKey:
            input?.masterEncryptionKey ?? SAMPLE_MASTER_ENCRYPTION_KEY,
          migrationsDir:
            input?.migrationsDir ?? "/tmp/onequery/runtime/migrations",
          port: input?.port ?? 5656,
          publicOrigin: input?.publicOrigin ?? "http://127.0.0.1:5656",
          rateLimitEnabled: input?.rateLimit?.enabled ?? true,
          rateLimitStorage: input?.rateLimit?.storage ?? "persistent",
          smtp: input?.smtp,
          storage: createPgliteStorageConfig({
            dir: input?.storageDir ?? "/tmp/onequery/pglite/onequery",
          }),
        }),
        launchId: input?.launchId ?? "test-self-host-launch",
        runtimePaths: input?.runtimePaths ?? createSelfHostRuntimePaths(),
        supervisor: input?.supervisor ?? createSelfHostSupervisor(),
        supervisorControl:
          input?.supervisorControl ?? createSelfHostSupervisorControl(),
      }),
    },
  });
}

function createServerLaunchCommonConfig(input: {
  assetsDistDir: string;
  authSecret: string;
  connectorEnrollmentToken: string;
  host: string;
  masterEncryptionKey: string;
  migrationsDir: string;
  port: number;
  publicOrigin: string;
  rateLimitEnabled: boolean;
  rateLimitStorage: ServerLaunchRateLimitStorage;
  smtp?: ServerLaunchSmtpConfig;
  storage: ServerLaunchStorageConfig;
}): ServerLaunchCommonConfig {
  return create(ServerLaunchCommonConfigSchema, {
    assets: {
      distDir: input.assetsDistDir,
    },
    auth: {
      secret: input.authSecret,
    },
    connectors: {
      enrollmentToken: input.connectorEnrollmentToken,
    },
    crypto: {
      masterEncryptionKey: decodeMasterEncryptionKey(input.masterEncryptionKey),
    },
    listen: {
      host: input.host,
      port: input.port,
    },
    migrations: {
      dir: input.migrationsDir,
    },
    publicOrigin: input.publicOrigin,
    rateLimit: create(ServerLaunchRateLimitConfigSchema, {
      api: create(ServerLaunchApiRateLimitConfigSchema, {
        storage:
          input.rateLimitStorage === "persistent"
            ? ServerLaunchApiRateLimitStorage.PERSISTENT
            : ServerLaunchApiRateLimitStorage.MEMORY,
      }),
      enabled: input.rateLimitEnabled,
    }),
    storage: input.storage,
    ...(input.smtp === undefined ? {} : { smtp: input.smtp }),
  });
}

function createPostgresStorageConfig(input: {
  url: string;
}): ServerLaunchStorageConfig {
  return create(ServerLaunchStorageConfigSchema, {
    kind: {
      case: "postgres",
      value: {
        url: input.url,
      },
    },
  });
}

function createPgliteStorageConfig(input: {
  dir: string;
}): ServerLaunchStorageConfig {
  return create(ServerLaunchStorageConfigSchema, {
    kind: {
      case: "pglite",
      value: {
        dir: input.dir,
      },
    },
  });
}
