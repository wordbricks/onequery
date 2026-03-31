import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { createServerRuntimeConfig } from "@onequery/server/runtime";

import { createApp } from "./app";
import { DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS } from "./constants";
import { prepareRuntimeDatabase } from "./database";
import { createRuntimeConfig } from "./runtime-env";
import type { BunRuntimeConfig } from "./runtime-env";
import {
  acquireRuntimeLifecycleLease,
  appendLifecycleLog,
  attachGracefulShutdownHandlers,
} from "./self-host/lifecycle";
import { resolveSelfHostRuntimePaths } from "./self-host/paths";
import type { SelfHostRuntimePaths } from "./self-host/paths";

function requireConfiguredString(
  value: string | undefined,
  name: string
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required runtime value: ${name}`);
  }

  return normalized;
}

function parseOptionalPort(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  return parsed > 0 ? parsed : undefined;
}

function parseBooleanEnvValue(value: boolean | string | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return value?.trim().toLowerCase() === "true";
}

function createLaunchConfig(
  runtimeConfig: BunRuntimeConfig,
  selfHostPaths: SelfHostRuntimePaths
): ServerLaunchConfig {
  const { env } = runtimeConfig;
  const smtpHost = env.SMTP_HOST?.trim();
  const smtpFromEmail = env.SMTP_FROM_EMAIL?.trim();
  const smtpPort = parseOptionalPort(env.SMTP_PORT);

  return {
    assets: {
      distDir: "",
    },
    auth: {
      secret: requireConfiguredString(
        env.BETTER_AUTH_SECRET,
        "BETTER_AUTH_SECRET"
      ),
    },
    connectors: {
      enrollmentToken: requireConfiguredString(
        env.CONNECTOR_ENROLLMENT_TOKEN,
        "CONNECTOR_ENROLLMENT_TOKEN"
      ),
    },
    crypto: {
      masterEncryptionKey: requireConfiguredString(
        env.MASTER_ENCRYPTION_KEY,
        "MASTER_ENCRYPTION_KEY"
      ),
    },
    listen: {
      host: runtimeConfig.listenHost,
      port: runtimeConfig.port,
    },
    mode: process.env.DATABASE_URL ? "workspace-dev" : "self-host",
    publicOrigin: requireConfiguredString(
      env.BETTER_AUTH_URL,
      "BETTER_AUTH_URL"
    ),
    rateLimit: {
      enabled: !parseBooleanEnvValue(env.DISABLE_RATE_LIMIT),
      storage: "persistent",
    },
    runtimePaths: {
      backupsDir: selfHostPaths.backupsDir,
      dataDir: selfHostPaths.dataDir,
      lockPath: selfHostPaths.lockPath,
      logsDir: selfHostPaths.logsDir,
      pidPath: selfHostPaths.pidPath,
      runDir: selfHostPaths.runDir,
    },
    smtp:
      smtpHost && smtpFromEmail && smtpPort
        ? {
            fromEmail: smtpFromEmail,
            fromName: env.SMTP_FROM_NAME?.trim(),
            host: smtpHost,
            password: env.SMTP_PASSWORD?.trim(),
            port: smtpPort,
            secure: parseBooleanEnvValue(env.SMTP_SECURE),
            username: env.SMTP_USERNAME?.trim(),
          }
        : undefined,
    storage: env.DATABASE_URL?.startsWith("pglite:")
      ? {
          dir: selfHostPaths.pgliteDir,
          kind: "pglite",
        }
      : env.DATABASE_URL
      ? {
          kind: "postgres",
          url: env.DATABASE_URL,
        }
      : {
          dir: selfHostPaths.pgliteDir,
          kind: "pglite",
        },
  };
}

const selfHostPaths = resolveSelfHostRuntimePaths(process.env);
const lifecycleLogWriter = {
  append(message: string) {
    return appendLifecycleLog(selfHostPaths, message);
  },
};
const lifecycleLease = await acquireRuntimeLifecycleLease(selfHostPaths, {
  logWriter: lifecycleLogWriter,
});

try {
  const runtimeConfig = createRuntimeConfig({ selfHostPaths });
  const launchConfig = createLaunchConfig(runtimeConfig, selfHostPaths);
  const runtime = createServerRuntimeConfig(launchConfig, {
    rateLimitStorage: runtimeConfig.env.RATE_LIMIT_STORAGE,
  });
  // Comment: The Bun runtime is the single owner of main application schema
  // convergence; local bootstrap only guarantees the shared Postgres container.
  await prepareRuntimeDatabase({
    databaseUrl: runtime.storage.connectionString,
    rootDir: process.env.ONEQUERY_RUNTIME_ROOT ?? process.cwd(),
  });
  const { listenHost: hostname, port } = runtimeConfig;
  const app = createApp({
    runtime,
    spaAssets: runtimeConfig.env.SPA_ASSETS,
  });

  const server = Bun.serve({
    fetch(request) {
      return app.fetch(request);
    },
    hostname,
    idleTimeout: DEFAULT_BUN_SERVER_IDLE_TIMEOUT_SECONDS,
    port,
  });

  const listenAddress = `http://${server.hostname}:${server.port}`;

  attachGracefulShutdownHandlers({
    lease: lifecycleLease,
    logWriter: lifecycleLogWriter,
    server,
  });

  await lifecycleLogWriter.append(`[bun-server] listening on ${listenAddress}`);
  console.log(`[bun-server] listening on ${listenAddress}`);
} catch (error) {
  await lifecycleLease.release({
    reason: "startup_failure",
    stopServer: false,
  });
  throw error;
}
