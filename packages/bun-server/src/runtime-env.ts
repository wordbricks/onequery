import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigFromSourcesSync } from "@onequery/config-loader";
import { createLocalProcessEnv } from "@onequery/dev-config/local-env";
import type { RuntimeRateLimitStorage } from "@onequery/server/lib/rate-limit-storage";
import { z } from "zod";

import { createSpaAssetBinding, getDefaultSpaBuildDir } from "./assets";
import {
  DEFAULT_BUN_RUNTIME_LISTEN_HOST,
  DEFAULT_BUN_RUNTIME_PORT,
  RUNTIME_RATE_LIMIT_STORAGE_DIRNAME,
  resolveDefaultPublicHost,
  resolveDefaultPublicOrigin,
  toPgliteConnectionString,
} from "./constants";
import { createPersistentRuntimeRateLimitStorage } from "./rate-limit-storage";
import { resolveSelfHostRuntimePaths } from "./self-host/paths";
import type { SelfHostRuntimePaths } from "./self-host/paths";

type SpaAssetBinding = {
  fetch: (request: Request) => Promise<Response>;
};

const defaultRootDir = fileURLToPath(new URL("../../..", import.meta.url));

export type BunRuntimeEnv = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CONNECTOR_ENROLLMENT_TOKEN?: string;
  DATABASE_URL?: string;
  DISABLE_RATE_LIMIT?: boolean | string;
  MASTER_ENCRYPTION_KEY: string;
  RATE_LIMIT_STORAGE: RuntimeRateLimitStorage;
  SPA_ASSETS: SpaAssetBinding;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  SMTP_HOST?: string;
  SMTP_PASSWORD?: string;
  SMTP_PORT?: number | string;
  SMTP_SECURE?: boolean | string;
  SMTP_USERNAME?: string;
  WEB_URL: string;
};

export type BunRuntimeConfig = {
  env: BunRuntimeEnv;
  listenHost: string;
  port: number;
};

const optionalStringSchema = z.string().trim().min(1).optional();

const serverSectionSchema = z.object({
  listen_host: z
    .string()
    .trim()
    .min(1)
    .default(DEFAULT_BUN_RUNTIME_LISTEN_HOST),
  log_level: z.string().trim().min(1).default("info"),
  port: z.number().int().positive().default(DEFAULT_BUN_RUNTIME_PORT),
  public_origin: z.string().trim().url().optional(),
});

const smtpConfigSectionSchema = z.object({
  from_email: optionalStringSchema,
  from_name: optionalStringSchema,
  host: optionalStringSchema,
  port: z.number().int().positive().optional(),
  secure: z.boolean().optional(),
  username: optionalStringSchema,
});

function withEmptyObjectDefault<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => value ?? {}, schema);
}

const selfHostConfigTomlSchema = z.object({
  server: withEmptyObjectDefault(serverSectionSchema),
  smtp: withEmptyObjectDefault(smtpConfigSectionSchema),
});

const selfHostSecretsTomlSchema = z.object({
  auth: withEmptyObjectDefault(
    z.object({
      better_auth_secret: optionalStringSchema,
    })
  ),
  crypto: withEmptyObjectDefault(
    z.object({
      master_encryption_key: optionalStringSchema,
    })
  ),
  connectors: withEmptyObjectDefault(
    z.object({
      enrollment_token: optionalStringSchema,
    })
  ),
  smtp: withEmptyObjectDefault(
    z.object({
      password: optionalStringSchema,
    })
  ),
});

export function createRuntimeEnv(
  input: {
    processEnv?: NodeJS.ProcessEnv;
    rootDir?: string;
    selfHostPaths?: SelfHostRuntimePaths;
  } = {}
): BunRuntimeEnv {
  return createRuntimeConfig(input).env;
}

export function createRuntimeConfig(
  input: {
    processEnv?: NodeJS.ProcessEnv;
    rootDir?: string;
    selfHostPaths?: SelfHostRuntimePaths;
  } = {}
): BunRuntimeConfig {
  const processEnv = input.processEnv ?? process.env;
  const rootDir = resolveRuntimeRootDir(input.rootDir, processEnv);
  const env = createLocalProcessEnv(rootDir, processEnv);
  const selfHostPaths =
    input.selfHostPaths ?? resolveSelfHostRuntimePaths(processEnv);
  const config = readSelfHostConfig(selfHostPaths);
  const secretsConfig = readSecretsConfig(selfHostPaths);
  const assetDir = processEnv.ONEQUERY_WEB_DIST_DIR
    ? resolve(rootDir, processEnv.ONEQUERY_WEB_DIST_DIR)
    : getDefaultSpaBuildDir(rootDir);
  const listenHost = processEnv.HOST ?? config.server.listen_host;
  const port = parsePortValue(processEnv.PORT, config.server.port);
  const publicOrigin =
    processEnv.BETTER_AUTH_URL ??
    processEnv.WEB_URL ??
    config.server.public_origin ??
    env.BETTER_AUTH_URL ??
    env.WEB_URL ??
    resolveDefaultPublicOrigin({ listenHost, port });

  return {
    env: {
      BETTER_AUTH_SECRET:
        processEnv.BETTER_AUTH_SECRET ??
        secretsConfig.auth.better_auth_secret ??
        env.BETTER_AUTH_SECRET ??
        "",
      BETTER_AUTH_URL: publicOrigin,
      CONNECTOR_ENROLLMENT_TOKEN:
        processEnv.CONNECTOR_ENROLLMENT_TOKEN ??
        secretsConfig.connectors.enrollment_token,
      DATABASE_URL:
        processEnv.DATABASE_URL ??
        toPgliteConnectionString(selfHostPaths.pgliteDir),
      DISABLE_RATE_LIMIT:
        processEnv.DISABLE_RATE_LIMIT ?? env.DISABLE_RATE_LIMIT,
      MASTER_ENCRYPTION_KEY:
        processEnv.MASTER_ENCRYPTION_KEY ??
        secretsConfig.crypto.master_encryption_key ??
        env.MASTER_ENCRYPTION_KEY ??
        "",
      RATE_LIMIT_STORAGE: createPersistentRuntimeRateLimitStorage(
        join(selfHostPaths.dataDir, RUNTIME_RATE_LIMIT_STORAGE_DIRNAME)
      ),
      SPA_ASSETS: createSpaAssetBinding({
        assetDir,
      }),
      SMTP_FROM_EMAIL:
        processEnv.SMTP_FROM_EMAIL ??
        config.smtp.from_email ??
        env.SMTP_FROM_EMAIL,
      SMTP_FROM_NAME:
        processEnv.SMTP_FROM_NAME ??
        config.smtp.from_name ??
        env.SMTP_FROM_NAME,
      SMTP_HOST: processEnv.SMTP_HOST ?? config.smtp.host ?? env.SMTP_HOST,
      SMTP_PASSWORD:
        processEnv.SMTP_PASSWORD ??
        secretsConfig.smtp.password ??
        env.SMTP_PASSWORD,
      SMTP_PORT:
        processEnv.SMTP_PORT ??
        (config.smtp.port !== undefined
          ? String(config.smtp.port)
          : env.SMTP_PORT),
      SMTP_SECURE:
        processEnv.SMTP_SECURE ??
        (config.smtp.secure !== undefined
          ? String(config.smtp.secure)
          : env.SMTP_SECURE),
      SMTP_USERNAME:
        processEnv.SMTP_USERNAME ?? config.smtp.username ?? env.SMTP_USERNAME,
      WEB_URL: publicOrigin,
    },
    listenHost,
    port,
  };
}

function resolveRuntimeRootDir(
  rootDir: string | undefined,
  processEnv: NodeJS.ProcessEnv
): string {
  if (rootDir) {
    return resolve(rootDir);
  }

  if (processEnv.ONEQUERY_RUNTIME_ROOT) {
    return resolve(processEnv.ONEQUERY_RUNTIME_ROOT);
  }

  return defaultRootDir;
}

function readSelfHostConfig(selfHostPaths: SelfHostRuntimePaths) {
  return loadConfigFromSourcesSync({
    schema: selfHostConfigTomlSchema,
    tomlPath: selfHostPaths.configPath,
  });
}

function readSecretsConfig(selfHostPaths: SelfHostRuntimePaths) {
  return loadConfigFromSourcesSync({
    schema: selfHostSecretsTomlSchema,
    tomlPath: selfHostPaths.secretsPath,
  });
}

function parsePortValue(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return fallback;
  }
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return parsed;
}

export { resolveDefaultPublicHost as resolvePublicHost };
