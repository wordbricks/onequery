import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { z } from "zod";

import { getDefaultSpaBuildDir } from "./assets";

const defaultRootDir = fileURLToPath(new URL("../../..", import.meta.url));

export const PUBLIC_ORIGIN_ENV_VAR = "ONEQUERY_PUBLIC_ORIGIN";

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

export interface CreateWorkspaceDevLaunchConfigOptions {
  processEnv?: NodeJS.ProcessEnv;
  rootDir?: string;
}

function buildLaunchConfigError(source: string, error: z.ZodError): Error {
  const issues = error.issues.map((issue) => {
    const path =
      issue.path.length === 0
        ? "(root)"
        : issue.path.map((entry) => String(entry)).join(".");
    return `- ${path}: ${issue.message}`;
  });

  return new Error(
    [`Invalid launch config from ${source}.`, ...issues].join("\n")
  );
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

export function createWorkspaceDevLaunchConfig(
  input: CreateWorkspaceDevLaunchConfigOptions = {}
): ServerLaunchConfig {
  const processEnv = input.processEnv ?? process.env;
  const rootDir = resolveRuntimeRootDir(input.rootDir, processEnv);
  const publicOrigin = requireConfiguredString(
    processEnv[PUBLIC_ORIGIN_ENV_VAR],
    PUBLIC_ORIGIN_ENV_VAR
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

function resolveStorageConfig(
  databaseUrl: string
): ServerLaunchConfig["storage"] {
  if (databaseUrl.startsWith("pglite:")) {
    return {
      dir: databaseUrl.slice("pglite:".length),
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

function parseRequiredPortValue(value: string | undefined, name: string): number {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required runtime value: ${name}`);
  }

  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return parsed;
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
