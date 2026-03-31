import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigFromSourcesSync } from "@onequery/config-loader";
import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { z } from "zod";

import { getDefaultSpaBuildDir } from "./assets";
import type { SelfHostRuntimePaths } from "./self-host/paths";
import { resolveSelfHostRuntimePaths } from "./self-host/paths";

const defaultRootDir = fileURLToPath(new URL("../../..", import.meta.url));
const PGLITE_URL_PREFIX = "pglite:";

export const DEFAULT_SELF_HOST_LISTEN_HOST = "127.0.0.1";
export const DEFAULT_SELF_HOST_PORT = 5656;

const nonEmptyStringSchema = z.string().trim().min(1);
const optionalStringSchema = nonEmptyStringSchema.optional();
const portSchema = z.number().int().min(1).max(65535);
const originSchema = z.string().trim().url();

const serverLaunchRuntimePathsSchema = z.object({
  backupsDir: nonEmptyStringSchema,
  dataDir: nonEmptyStringSchema,
  lockPath: nonEmptyStringSchema,
  logsDir: nonEmptyStringSchema,
  pidPath: nonEmptyStringSchema,
  runDir: nonEmptyStringSchema,
});

const serverLaunchStorageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("postgres"),
    url: nonEmptyStringSchema,
  }),
  z.object({
    dir: nonEmptyStringSchema,
    kind: z.literal("pglite"),
  }),
]);

const serverLaunchSmtpSchema = z.object({
  fromEmail: nonEmptyStringSchema,
  fromName: optionalStringSchema,
  host: nonEmptyStringSchema,
  password: optionalStringSchema,
  port: portSchema,
  secure: z.boolean().optional(),
  username: optionalStringSchema,
});

const serverLaunchConfigSchema = z
  .object({
    assets: z.object({
      distDir: nonEmptyStringSchema,
    }),
    auth: z.object({
      secret: nonEmptyStringSchema,
    }),
    connectors: z.object({
      enrollmentToken: nonEmptyStringSchema,
    }),
    crypto: z.object({
      masterEncryptionKey: nonEmptyStringSchema,
    }),
    listen: z.object({
      host: nonEmptyStringSchema,
      port: portSchema,
    }),
    mode: z.enum(["workspace-dev", "self-host"]),
    publicOrigin: originSchema,
    rateLimit: z.object({
      enabled: z.boolean(),
      storage: z.enum(["memory", "persistent"]),
    }),
    runtimePaths: serverLaunchRuntimePathsSchema.optional(),
    smtp: serverLaunchSmtpSchema.optional(),
    storage: serverLaunchStorageSchema,
  })
  .superRefine((value, context) => {
    if (value.rateLimit.storage === "persistent" && !value.runtimePaths) {
      context.addIssue({
        code: "custom",
        message: "Persistent rate limiting requires runtimePaths.",
        path: ["runtimePaths"],
      });
    }

    if (value.mode === "self-host" && !value.runtimePaths) {
      context.addIssue({
        code: "custom",
        message: "Self-host launch config requires runtimePaths.",
        path: ["runtimePaths"],
      });
    }
  });

const serverSectionSchema = z.object({
  listen_host: nonEmptyStringSchema.default(DEFAULT_SELF_HOST_LISTEN_HOST),
  log_level: nonEmptyStringSchema.default("info"),
  port: portSchema.default(DEFAULT_SELF_HOST_PORT),
  public_origin: originSchema.optional(),
});

const smtpConfigSectionSchema = z.object({
  from_email: optionalStringSchema,
  from_name: optionalStringSchema,
  host: optionalStringSchema,
  port: portSchema.optional(),
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

export interface CreateLaunchConfigOptions {
  mode: ServerLaunchConfig["mode"];
  processEnv?: NodeJS.ProcessEnv;
  rootDir?: string;
  selfHostPaths?: SelfHostRuntimePaths;
}

function buildLaunchConfigError(
  source: string,
  error: z.ZodError
): Error {
  const issues = error.issues.map((issue) => {
    const path =
      issue.path.length === 0
        ? "(root)"
        : issue.path.map((entry) => String(entry)).join(".");
    return `- ${path}: ${issue.message}`;
  });

  return new Error([`Invalid launch config from ${source}.`, ...issues].join("\n"));
}

export function validateLaunchConfig(
  value: unknown,
  source: string
): ServerLaunchConfig {
  const parsed = serverLaunchConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw buildLaunchConfigError(source, parsed.error);
  }

  return parsed.data;
}

export function loadLaunchConfigFile(path: string): ServerLaunchConfig {
  const resolvedPath = resolve(path);
  let contents: string;

  try {
    contents = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read launch config file: ${resolvedPath}\n${(error as Error).message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Invalid launch config JSON: ${resolvedPath}\n${(error as Error).message}`
    );
  }

  return validateLaunchConfig(parsed, `file ${resolvedPath}`);
}

export function createLaunchConfig(
  input: CreateLaunchConfigOptions
): ServerLaunchConfig {
  if (input.mode === "workspace-dev") {
    return createWorkspaceDevLaunchConfig(input);
  }

  return createSelfHostLaunchConfig(input);
}

export function createWorkspaceDevLaunchConfig(
  input: Omit<CreateLaunchConfigOptions, "mode"> = {}
): ServerLaunchConfig {
  const processEnv = input.processEnv ?? process.env;
  const rootDir = resolveRuntimeRootDir(input.rootDir, processEnv);
  const publicOrigin = requireConfiguredString(
    processEnv.WEB_URL ?? processEnv.BETTER_AUTH_URL,
    "WEB_URL"
  );
  const databaseUrl = requireConfiguredString(
    processEnv.DATABASE_URL,
    "DATABASE_URL"
  );

  return validateLaunchConfig(
    {
      assets: {
        distDir: resolveSpaAssetDir(rootDir, processEnv),
      },
      auth: {
        secret: requireConfiguredString(
          processEnv.BETTER_AUTH_SECRET,
          "BETTER_AUTH_SECRET"
        ),
      },
      connectors: {
        enrollmentToken: requireConfiguredString(
          processEnv.CONNECTOR_ENROLLMENT_TOKEN,
          "CONNECTOR_ENROLLMENT_TOKEN"
        ),
      },
      crypto: {
        masterEncryptionKey: requireConfiguredString(
          processEnv.MASTER_ENCRYPTION_KEY,
          "MASTER_ENCRYPTION_KEY"
        ),
      },
      listen: {
        host: requireConfiguredString(processEnv.HOST, "HOST"),
        port: parseRequiredPortValue(processEnv.PORT, "PORT"),
      },
      mode: "workspace-dev",
      publicOrigin,
      rateLimit: {
        enabled: !parseBooleanEnvValue(processEnv.DISABLE_RATE_LIMIT),
        storage: "memory",
      },
      smtp: resolveSmtpConfig({
        fromEmail: processEnv.SMTP_FROM_EMAIL,
        fromName: processEnv.SMTP_FROM_NAME,
        host: processEnv.SMTP_HOST,
        password: processEnv.SMTP_PASSWORD,
        port: parseOptionalPort(processEnv.SMTP_PORT),
        secure: parseOptionalBooleanEnvValue(processEnv.SMTP_SECURE),
        username: processEnv.SMTP_USERNAME,
      }),
      storage: resolveStorageConfig(databaseUrl),
    },
    "workspace-dev env"
  );
}

export function createSelfHostLaunchConfig(
  input: Omit<CreateLaunchConfigOptions, "mode"> = {}
): ServerLaunchConfig {
  const processEnv = input.processEnv ?? process.env;
  const rootDir = resolveRuntimeRootDir(input.rootDir, processEnv);
  const selfHostPaths =
    input.selfHostPaths ?? resolveSelfHostRuntimePaths(processEnv);
  const config = readSelfHostConfig(selfHostPaths);
  const secretsConfig = readSecretsConfig(selfHostPaths);
  const listenHost = processEnv.HOST ?? config.server.listen_host;
  const port = parsePortValue(processEnv.PORT, config.server.port);
  const publicOrigin =
    processEnv.BETTER_AUTH_URL ??
    processEnv.WEB_URL ??
    config.server.public_origin ??
    resolveDefaultPublicOrigin({
      listenHost,
      port,
    });

  return validateLaunchConfig(
    {
      assets: {
        distDir: resolveSpaAssetDir(rootDir, processEnv),
      },
      auth: {
        secret:
          processEnv.BETTER_AUTH_SECRET ??
          secretsConfig.auth.better_auth_secret ??
          "",
      },
      connectors: {
        enrollmentToken:
          processEnv.CONNECTOR_ENROLLMENT_TOKEN ??
          secretsConfig.connectors.enrollment_token ??
          "",
      },
      crypto: {
        masterEncryptionKey:
          processEnv.MASTER_ENCRYPTION_KEY ??
          secretsConfig.crypto.master_encryption_key ??
          "",
      },
      listen: {
        host: listenHost,
        port,
      },
      mode: "self-host",
      publicOrigin,
      rateLimit: {
        enabled: !parseBooleanEnvValue(processEnv.DISABLE_RATE_LIMIT),
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
      smtp: resolveSmtpConfig({
        fromEmail: processEnv.SMTP_FROM_EMAIL ?? config.smtp.from_email,
        fromName: processEnv.SMTP_FROM_NAME ?? config.smtp.from_name,
        host: processEnv.SMTP_HOST ?? config.smtp.host,
        password: processEnv.SMTP_PASSWORD ?? secretsConfig.smtp.password,
        port:
          parseOptionalPort(processEnv.SMTP_PORT) ?? config.smtp.port,
        secure:
          parseOptionalBooleanEnvValue(processEnv.SMTP_SECURE) ??
          config.smtp.secure,
        username: processEnv.SMTP_USERNAME ?? config.smtp.username,
      }),
      storage: resolveStorageConfig(
        processEnv.DATABASE_URL ?? toPgliteConnectionString(selfHostPaths.pgliteDir)
      ),
    },
    "self-host config"
  );
}

export function resolveDefaultPublicOrigin(input: {
  listenHost: string;
  port: number;
}): string {
  return `http://${resolveDefaultPublicHost(input.listenHost)}:${input.port}`;
}

export function resolveDefaultPublicHost(listenHost: string): string {
  if (listenHost === "0.0.0.0") {
    return DEFAULT_SELF_HOST_LISTEN_HOST;
  }

  return listenHost;
}

export function resolveRuntimeRootDir(
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

function resolveSpaAssetDir(
  rootDir: string,
  processEnv: NodeJS.ProcessEnv
): string {
  if (processEnv.ONEQUERY_WEB_DIST_DIR) {
    return resolve(rootDir, processEnv.ONEQUERY_WEB_DIST_DIR);
  }

  return getDefaultSpaBuildDir(rootDir);
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

function resolveStorageConfig(
  databaseUrl: string
): ServerLaunchConfig["storage"] {
  if (databaseUrl.startsWith(PGLITE_URL_PREFIX)) {
    return {
      dir: databaseUrl.slice(PGLITE_URL_PREFIX.length),
      kind: "pglite",
    };
  }

  return {
    kind: "postgres",
    url: databaseUrl,
  };
}

function resolveSmtpConfig(input: {
  fromEmail?: string;
  fromName?: string;
  host?: string;
  password?: string;
  port?: number;
  secure?: boolean;
  username?: string;
}): ServerLaunchConfig["smtp"] | undefined {
  const host = input.host?.trim();
  const fromEmail = input.fromEmail?.trim();

  if (!host || !fromEmail || !input.port) {
    return undefined;
  }

  return {
    fromEmail,
    fromName: input.fromName?.trim(),
    host,
    password: input.password?.trim(),
    port: input.port,
    secure: input.secure,
    username: input.username?.trim(),
  };
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

function parseOptionalBooleanEnvValue(
  value: boolean | string | undefined
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseBooleanEnvValue(value);
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

function parseRequiredPortValue(value: string | undefined, name: string): number {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required runtime value: ${name}`);
  }

  return parsePortValue(normalized, Number.NaN);
}

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

function toPgliteConnectionString(pgliteDir: string): string {
  return `${PGLITE_URL_PREFIX}${pgliteDir}`;
}
